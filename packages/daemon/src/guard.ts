// Tamper guard: an agent may not change Nocap's own setup. Owner: Role A.
// Seen live: an agent ran `rm -rf .github` (which holds .github/hooks/nocap.json) while being checked.
// Deleting, moving or writing Nocap's config, hook files or logs is blocked outright, no pop-up: the developer
// changes them in the Nocap panel or by hand, never through an agent. Reads stay allowed.
import { isAbsolute, normalize, relative } from 'node:path';
import { parse } from 'shell-quote';
import type { CheckRequest } from '@nocap/shared';

/** Nocap's files, relative to the workspace. */
export const NOCAP_FILES = [
  '.nocap.yml',
  '.nocap.audit.jsonl',
  '.nocap.sessions.jsonl',
  '.claude/settings.local.json',
  '.github/hooks/nocap.json',
  '.agents/hooks.json',
  '.cursor/hooks.json',
  '.codex/hooks.json',
  '.gemini/settings.json',
];

const WRITE_TOOLS = new Set(['rm', 'rmdir', 'unlink', 'mv', 'truncate', 'shred', 'chmod', 'chown']);

function rel(cwd: string, p: string): string {
  const r = isAbsolute(p) ? relative(cwd, p) : normalize(p);
  return r.replace(/^\.\//, '').replace(/\/+$/, '');
}

/** True when `path` is a Nocap file or a folder containing one (deleting `.github` removes the hook file). */
function coversNocapFile(cwd: string, path: string): string | null {
  const p = rel(cwd, path);
  if (!p || p === '.' || p.startsWith('..')) return null; // whole-workspace or outside targets are other checks' business
  return NOCAP_FILES.find((f) => f === p || f.startsWith(p + '/')) ?? null;
}

/** The Nocap file this action would change, or null. */
export function tamperTarget(req: CheckRequest): string | null {
  if (req.edit) return coversNocapFile(req.cwd, req.edit.file) && rel(req.cwd, req.edit.file);

  const tokens = parse(req.command, (k) => `$${k}`);
  let bin: string | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (typeof t !== 'string') {
      // Redirection into a Nocap file: `echo x > .nocap.yml`, `>> .claude/settings.local.json`
      if ('op' in t && (t.op === '>' || t.op === '>>')) {
        const target = tokens[i + 1];
        if (typeof target === 'string' && coversNocapFile(req.cwd, target)) return rel(req.cwd, target);
      }
      bin = null; // next command in a pipeline / list
      continue;
    }
    if (bin === null) {
      bin = t.split('/').pop() ?? t;
      continue;
    }
    const writes = WRITE_TOOLS.has(bin) || (bin === 'sed' && tokens.some((x) => typeof x === 'string' && /^-i/.test(x))) || bin === 'tee';
    if (writes && !t.startsWith('-')) {
      const hit = coversNocapFile(req.cwd, t);
      if (hit) return rel(req.cwd, t);
    }
  }
  return null;
}
