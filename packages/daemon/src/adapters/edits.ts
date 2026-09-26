// Turns an agent's file-edit tool call into a CheckRequest `edit` (old/new text), shared by all agent adapters.
// Owner: Role A. `old` is the file as it is now, so the test-diff measurer (FR-T1..T5) can count assertions.
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { FileEdit } from '@nocap/shared';

export function resolvePath(cwd: string, file: string): string {
  return isAbsolute(file) ? file : join(cwd, file);
}

function readCurrent(cwd: string, file: string): string | null {
  try {
    return readFileSync(resolvePath(cwd, file), 'utf8');
  } catch {
    return null; // new file
  }
}

/** Whole-file write (Claude Write, Gemini write_file). */
export function writeEdit(cwd: string, file: string, content: string): FileEdit {
  return { file, old: readCurrent(cwd, file) ?? '', new: content ?? '' };
}

/** One or more find/replace edits applied to the current file (Claude Edit/MultiEdit, Gemini replace). */
export function replaceEdit(
  cwd: string,
  file: string,
  edits: { old_string: string; new_string: string; replace_all?: boolean }[],
): FileEdit {
  const current = readCurrent(cwd, file);
  if (current === null) {
    // Can't see the file: fall back to the snippets themselves.
    return { file, old: edits.map((e) => e.old_string).join('\n'), new: edits.map((e) => e.new_string).join('\n') };
  }
  let next = current;
  for (const e of edits) {
    next = e.replace_all ? next.split(e.old_string).join(e.new_string) : next.replace(e.old_string, () => e.new_string);
  }
  return { file, old: current, new: next };
}

/**
 * Codex `apply_patch` format:
 *   *** Begin Patch / *** Update File: path / @@ / -old / +new / *** End Patch   (also Add File, Delete File)
 * Returns one edit per file.
 */
export function patchEdits(cwd: string, patch: string): FileEdit[] {
  const out: FileEdit[] = [];
  let cur: { file: string; kind: 'update' | 'add' | 'delete'; old: string[]; new: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    if (cur.kind === 'delete') out.push({ file: cur.file, old: readCurrent(cwd, cur.file) ?? '', new: '' });
    else if (cur.kind === 'add') out.push({ file: cur.file, old: '', new: cur.new.join('\n') });
    else out.push({ file: cur.file, old: cur.old.join('\n'), new: cur.new.join('\n') });
    cur = null;
  };
  for (const line of patch.split('\n')) {
    const header = line.match(/^\*\*\* (Update|Add|Delete) File: (.+)$/);
    if (header) {
      flush();
      cur = { file: header[2].trim(), kind: header[1].toLowerCase() as 'update' | 'add' | 'delete', old: [], new: [] };
      continue;
    }
    if (!cur || line.startsWith('***') || line.startsWith('@@')) continue;
    if (line.startsWith('-')) cur.old.push(line.slice(1));
    else if (line.startsWith('+')) cur.new.push(line.slice(1));
    else if (line.startsWith(' ')) (cur.old.push(line.slice(1)), cur.new.push(line.slice(1)));
  }
  flush();
  return out;
}

/** When one call edits several files, check the most suspicious one: a test file if there is one. */
export function pickEdit(edits: FileEdit[]): FileEdit | undefined {
  const isTest = (f: string) => /(^|\/)([^/]+\.(test|spec)\.[^/]+|test_[^/]+\.py)$|(^|\/)tests?\//.test(f);
  return edits.find((e) => isTest(e.file)) ?? edits[0];
}
