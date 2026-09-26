// A3: merge nocap's hooks into each agent's project hook config without overwriting anything.
//   Claude Code  .claude/settings.local.json  (gitignored, so teammates without nocap aren't blocked)
//   Codex CLI    .codex/hooks.json            (Codex asks the developer to trust new hooks once, via /hooks)
//   Gemini CLI   .gemini/settings.json        (timeouts in milliseconds)
// Codex and Gemini hooks are only installed when that agent is on this machine.
import * as vscode from 'vscode';
import { existsSync, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

const MARKER = 'nocap-hook.sh';
const HOLD_SECONDS = 300; // FR-H1: the human pop-up may hold a command for up to 5 minutes

type HookEntry = { matcher?: string; hooks: { type: 'command'; command: string; timeout?: number }[] };
type Settings = { hooks?: Record<string, HookEntry[]>; [k: string]: unknown };

interface AgentHooks {
  name: string;
  /** Config file, relative to the workspace root. */
  file: string;
  /** Installed only when this returns true. */
  present: () => boolean;
  /** event name in the agent's config → [nocap event, tool matcher (tool events only), timeout in the agent's unit]. */
  events: Record<string, [string, string | undefined, number]>;
  hookArg: string;
}

const AGENTS: AgentHooks[] = [
  {
    name: 'Claude Code',
    file: '.claude/settings.local.json',
    present: () => true,
    hookArg: 'claude',
    events: {
      PreToolUse: ['pre-tool-use', 'Bash|Edit|Write|MultiEdit', HOLD_SECONDS + 10],
      UserPromptSubmit: ['user-prompt-submit', undefined, 10],
    },
  },
  {
    name: 'Codex',
    file: '.codex/hooks.json',
    present: () => onMachine('codex', '.codex'),
    hookArg: 'codex',
    events: {
      PreToolUse: ['pre-tool-use', '^(Bash|apply_patch)$', HOLD_SECONDS + 10],
      UserPromptSubmit: ['user-prompt-submit', undefined, 10],
    },
  },
  {
    name: 'Gemini CLI',
    file: '.gemini/settings.json',
    present: () => onMachine('gemini', '.gemini'),
    hookArg: 'gemini',
    events: {
      BeforeTool: ['before-tool', '^(run_shell_command|write_file|replace|edit|edit_file)$', (HOLD_SECONDS + 10) * 1000],
      BeforeAgent: ['before-agent', undefined, 10_000],
    },
  },
];

/** The agent's CLI is on PATH (or a common install dir), or it has a config folder in the home directory. */
function onMachine(bin: string, homeDir: string): boolean {
  if (existsSync(join(homedir(), homeDir))) return true;
  const dirs = [...(process.env.PATH ?? '').split(delimiter), '/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.npm-global/bin')];
  return dirs.some((d) => d && existsSync(join(d, bin)));
}

async function read(file: string): Promise<Settings> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return {};
  }
}

/** Remove existing nocap entries (and events left empty) so re-running never duplicates them. */
function strip(settings: Settings) {
  for (const [event, entries] of Object.entries(settings.hooks ?? {})) {
    const kept = entries.filter((e) => !e.hooks?.some((h) => h.command.includes(MARKER)));
    if (kept.length) settings.hooks![event] = kept;
    else delete settings.hooks![event];
  }
}

export async function hooksInstalled(root: string): Promise<boolean> {
  for (const a of AGENTS) {
    if (JSON.stringify(await read(join(root, a.file))).includes(MARKER)) return true;
  }
  return false;
}

/** Installs hooks for every agent present on this machine. Returns the agents' names. */
export async function installHooks(context: vscode.ExtensionContext, root: string): Promise<string[]> {
  const script = `"${context.asAbsolutePath('dist/shims/hooks/nocap-hook.sh')}"`;
  const installed: string[] = [];

  for (const agent of AGENTS) {
    if (!agent.present()) continue;
    const file = join(root, agent.file);
    await fs.mkdir(dirname(file), { recursive: true });
    await fs.copyFile(file, file + '.nocap.bak').catch(() => {});

    const settings = await read(file);
    strip(settings);
    settings.hooks ??= {};
    for (const [event, [nocapEvent, matcher, timeout]] of Object.entries(agent.events)) {
      const entry: HookEntry = { hooks: [{ type: 'command', command: `${script} ${agent.hookArg} ${nocapEvent}`, timeout }] };
      if (matcher) entry.matcher = matcher;
      (settings.hooks[event] ??= []).push(entry);
    }
    await fs.writeFile(file, JSON.stringify(settings, null, 2) + '\n');
    installed.push(agent.name);
  }
  return installed;
}

export async function uninstallHooks(root: string) {
  for (const agent of AGENTS) {
    const file = join(root, agent.file);
    if (!existsSync(file)) continue;
    const settings = await read(file);
    strip(settings);
    await fs.writeFile(file, JSON.stringify(settings, null, 2) + '\n');
  }
}
