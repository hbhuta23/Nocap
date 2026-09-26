// VS Code chat (Copilot agent mode) hook adapter. Owner: Role A.
// VS Code runs hooks from .github/hooks/*.json (on by default, `chat.useHooks`). Its stdin is the
// Claude-compatible snake_case variant (session_id, cwd, tool_name, tool_input, hook_event_name); the
// GitHub Copilot variant is camelCase (sessionId, toolName, toolArgs). Both are accepted.
// Output: hookSpecificOutput.permissionDecision (VS Code docs) plus top-level permissionDecision (GitHub docs).
// Sources: code.visualstudio.com agent-customization/hooks, docs.github.com copilot hooks reference (2026-09-26).
//
// VS Code does not document its tool names, so mapping is by known names first, then by shape: any tool with
// a `command` string is a shell command, any tool with a file path and new content is an edit. That way an
// unknown or renamed tool is still checked.
// TODO(A0.2): confirm tool names against fixtures/hooks/vscode/ once recorded.

import type { FastifyInstance } from 'fastify';
import type { CheckRequest, VerdictResponse } from '@nocap/shared';
import { sessions } from '../sessions';
import { checkFromHook } from './claude';
import { replaceEdit, writeEdit, patchEdits, pickEdit, resolvePath } from './edits';

export interface VsCodeHookPayload {
  session_id?: string;
  sessionId?: string;
  cwd?: string;
  tool_name?: string;
  toolName?: string;
  tool_input?: Record<string, any>;
  toolArgs?: Record<string, any> | string;
  prompt?: string;
}

export function registerVsCodeRoutes(app: FastifyInstance) {
  app.post<{ Body: VsCodeHookPayload }>('/v1/vscode/pre-tool-use', async (req) => {
    const check = toVsCodeCheckRequest(req.body);
    if (!check) return {};
    const verdict = await checkFromHook(check);
    return toVsCodeOutput(verdict);
  });

  app.post<{ Body: VsCodeHookPayload }>('/v1/vscode/user-prompt-submit', async (req) => {
    const b = req.body;
    if (b.prompt) sessions.addPrompt(b.session_id ?? b.sessionId ?? 'vscode-chat', b.prompt, 'vscode_hook', b.cwd);
    return {};
  });
}

const SHELL_TOOLS = /^(run_in_terminal|runInTerminal|run_command|runCommand|terminal|bash|shell|execute_command)$/i;
const DELETE_TOOLS = /^(delete_file|deleteFile|remove_file|removeFile)$/i;

export function toVsCodeCheckRequest(p: VsCodeHookPayload): CheckRequest | null {
  const name = p.tool_name ?? p.toolName ?? '';
  let input: Record<string, any> = p.tool_input ?? {};
  if (!p.tool_input && p.toolArgs) {
    try {
      input = typeof p.toolArgs === 'string' ? JSON.parse(p.toolArgs) : p.toolArgs;
    } catch {
      input = {};
    }
  }
  const cwd = p.cwd ?? input.cwd ?? process.cwd();
  const base = { session_id: p.session_id ?? p.sessionId ?? 'vscode-chat', source: 'vscode_hook' as const, agent: 'vscode-chat' as const, cwd };
  const intent: string | null = input.explanation ?? input.description ?? input.goal ?? null;
  const file: string | undefined = input.filePath ?? input.file_path ?? input.path ?? input.uri;

  // Shell: by name, or any tool carrying a command string.
  if (SHELL_TOOLS.test(name) || (typeof input.command === 'string' && !file)) {
    return { ...base, tool: 'bash', command: String(input.command ?? ''), intent };
  }

  // Codex-style patches (VS Code has an apply_patch tool for some models).
  const patch = [input.input, input.patch].find((v): v is string => typeof v === 'string' && v.includes('*** Begin Patch'));
  if (patch) {
    const edits = patchEdits(cwd, patch);
    const edit = pickEdit(edits);
    return edit ? { ...base, tool: 'edit', command: `apply_patch ${edits.map((e) => e.file).join(' ')}`, edit, intent } : null;
  }

  if (!file) return null;
  const path = resolvePath(cwd, file.replace(/^file:\/\//, ''));

  if (DELETE_TOOLS.test(name)) {
    return { ...base, tool: 'bash', command: `rm ${path}`, intent };
  }
  // Find/replace edits: single (replace_string_in_file) or several (multi_replace_string_in_file).
  if (typeof input.oldString === 'string' || typeof input.old_string === 'string') {
    return { ...base, tool: 'edit', command: `edit ${path}`, edit: replaceEdit(cwd, path, [{ old_string: input.oldString ?? input.old_string, new_string: input.newString ?? input.new_string ?? '' }]), intent };
  }
  if (Array.isArray(input.replacements)) {
    const edits = input.replacements.map((r: any) => ({ old_string: r.oldString ?? r.old_string, new_string: r.newString ?? r.new_string ?? '' }));
    return { ...base, tool: 'edit', command: `edit ${path}`, edit: replaceEdit(cwd, path, edits), intent };
  }
  // Whole-file writes: create_file (content), insert_edit_into_file (code).
  const content = input.content ?? input.code ?? input.text;
  if (typeof content === 'string') {
    return { ...base, tool: 'write', command: `write ${path}`, edit: writeEdit(cwd, path, content), intent };
  }
  return null;
}

/** No decision = VS Code's normal flow; "allow" only after the developer confirmed in nocap (FR-H5). */
export function toVsCodeOutput(v: VerdictResponse) {
  let decision: 'allow' | 'deny' | 'ask' | null = null;
  let reason = '';
  if (v.verdict === 'allow' || v.verdict === 'warn') {
    if (v.human_confirmed) (decision = 'allow'), (reason = 'Confirmed by the developer in nocap');
  } else {
    decision = v.verdict === 'ask' ? 'ask' : 'deny';
    reason = v.reason_for_agent;
  }
  if (!decision) return {};
  return {
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason },
    permissionDecision: decision,
    permissionDecisionReason: reason,
  };
}
