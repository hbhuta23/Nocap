// A3: merge nocap's hooks into .claude/settings.local.json without overwriting anything.
// settings.local.json (gitignored) rather than settings.json, so teammates without nocap
// don't inherit hooks that block them with "nocap is offline".
import * as vscode from 'vscode';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const MARKER = 'nocap-hook.sh';

type HookEntry = { matcher?: string; hooks: { type: 'command'; command: string; timeout?: number }[] };
type Settings = { hooks?: Record<string, HookEntry[]>; [k: string]: unknown };

const settingsPath = (root: string) => join(root, '.claude', 'settings.local.json');

async function read(root: string): Promise<Settings> {
  try {
    return JSON.parse(await fs.readFile(settingsPath(root), 'utf8'));
  } catch {
    return {};
  }
}

/** Remove any existing nocap entries so re-running never duplicates them. */
function strip(settings: Settings) {
  for (const [event, entries] of Object.entries(settings.hooks ?? {})) {
    settings.hooks![event] = entries.filter((e) => !e.hooks.some((h) => h.command.includes(MARKER)));
  }
}

export async function hooksInstalled(root: string): Promise<boolean> {
  return JSON.stringify(await read(root)).includes(MARKER);
}

export async function installHooks(context: vscode.ExtensionContext, root: string) {
  const file = settingsPath(root);
  await fs.mkdir(join(root, '.claude'), { recursive: true });
  await fs.copyFile(file, file + '.nocap.bak').catch(() => {});

  const settings = await read(root);
  strip(settings);
  const hook = `"${context.asAbsolutePath('dist/shims/hooks/nocap-hook.sh')}"`;
  settings.hooks ??= {};
  (settings.hooks.PreToolUse ??= []).push({
    matcher: 'Bash|Edit|Write|MultiEdit',
    hooks: [{ type: 'command', command: `${hook} pre-tool-use`, timeout: 300 }],
  });
  (settings.hooks.UserPromptSubmit ??= []).push({
    hooks: [{ type: 'command', command: `${hook} user-prompt-submit`, timeout: 10 }],
  });

  await fs.writeFile(file, JSON.stringify(settings, null, 2) + '\n');
}

export async function uninstallHooks(root: string) {
  const settings = await read(root);
  strip(settings);
  await fs.writeFile(settingsPath(root), JSON.stringify(settings, null, 2) + '\n');
}
