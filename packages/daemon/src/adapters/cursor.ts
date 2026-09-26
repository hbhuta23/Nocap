// Cursor agent hook adapter. Owner: Role A.
// Config: <workspace>/.cursor/hooks.json { version: 1, hooks: { <event>: [{ command, timeout, matcher? }] } }.
// Events used:
//   beforeShellExecution  { command, cwd }            → shell checks
//   preToolUse            { tool_name, tool_input }   → file edits (shell tools are skipped here: they also fire
//                                                       beforeShellExecution, and one command must not prompt twice)
//   beforeSubmitPrompt    { prompt }                  → the task
// Base fields on every event: conversation_id, generation_id, workspace_roots, hook_event_name, ...
// Output: { permission: "allow" | "deny" | "ask", user_message, agent_message }; {} = Cursor's normal flow.
// Source: cursor.com/docs/agent/hooks (fetched 2026-09-26). Edit tool names are undocumented, so edits are
// mapped by shape via the VS Code adapter.
// TODO(A0.2): record real payloads into fixtures/hooks/cursor/.

import type { FastifyInstance } from 'fastify';
import type { CheckRequest, VerdictResponse } from '@nocap/shared';
import { sessions } from '../sessions';
import { checkFromHook } from './claude';
import { toVsCodeCheckRequest } from './vscode';

export interface CursorPayload {
  conversation_id?: string;
  workspace_roots?: string[];
  hook_event_name?: string;
  command?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, any>;
  prompt?: string;
}

const SHELL_TOOL = /shell|terminal|command|bash/i;

export function registerCursorRoutes(app: FastifyInstance) {
  app.post<{ Body: CursorPayload }>('/v1/cursor/before-shell', async (req) => respond(toCursorShellCheck(req.body)));
  app.post<{ Body: CursorPayload }>('/v1/cursor/pre-tool-use', async (req) => respond(toCursorToolCheck(req.body)));
  app.post<{ Body: CursorPayload }>('/v1/cursor/before-submit-prompt', async (req) => {
    const b = req.body;
    if (b.prompt) sessions.addPrompt(sessionOf(b), b.prompt, 'cursor_hook', b.workspace_roots?.[0] ?? b.cwd);
    return { continue: true };
  });
}

async function respond(check: CheckRequest | null) {
  if (!check) return {};
  return toCursorOutput(await checkFromHook(check));
}

const sessionOf = (p: CursorPayload) => p.conversation_id ?? 'cursor';
const cwdOf = (p: CursorPayload) => p.cwd ?? p.workspace_roots?.[0] ?? process.cwd();

export function toCursorShellCheck(p: CursorPayload): CheckRequest | null {
  if (!p.command) return null;
  return { session_id: sessionOf(p), source: 'cursor_hook', agent: 'cursor', cwd: cwdOf(p), tool: 'bash', command: p.command, intent: null };
}

export function toCursorToolCheck(p: CursorPayload): CheckRequest | null {
  if (SHELL_TOOL.test(p.tool_name ?? '') || typeof p.tool_input?.command === 'string') return null; // handled by beforeShellExecution
  const mapped = toVsCodeCheckRequest({ session_id: sessionOf(p), cwd: cwdOf(p), tool_name: p.tool_name, tool_input: p.tool_input });
  return mapped ? { ...mapped, source: 'cursor_hook', agent: 'cursor' } : null;
}

/** No decision = Cursor's normal flow; "allow" only after the developer confirmed in nocap (FR-H5). */
export function toCursorOutput(v: VerdictResponse) {
  if (v.verdict === 'allow' || v.verdict === 'warn') {
    return v.human_confirmed ? { permission: 'allow', user_message: 'Confirmed in nocap' } : {};
  }
  return {
    permission: v.verdict === 'ask' ? 'ask' : 'deny',
    user_message: `nocap: ${v.headline}`,
    agent_message: v.reason_for_agent,
  };
}
