// Gemini CLI hook adapter. Owner: Role A.
// Gemini CLI events: BeforeTool (tool calls) and BeforeAgent (the developer's prompt).
// Tools: run_shell_command, write_file, replace (edit). Output: { decision: "deny", reason } to block.
// Source: https://geminicli.com/docs/hooks/reference/ (fetched 2026-09-26).
// TODO(A0.2): verify tool names and tool_input fields against fixtures/hooks/gemini-cli/ once installed.

import type { FastifyInstance } from 'fastify';
import type { CheckRequest, VerdictResponse } from '@nocap/shared';
import { sessions } from '../sessions';
import { checkFromHook, type PreToolUsePayload, type UserPromptSubmitPayload } from './claude';
import { replaceEdit, writeEdit } from './edits';

export function registerGeminiRoutes(app: FastifyInstance) {
  app.post<{ Body: PreToolUsePayload }>('/v1/gemini/before-tool', async (req) => {
    const check = toGeminiCheckRequest(req.body);
    if (!check) return {};
    const verdict = await checkFromHook(check);
    return toGeminiOutput(verdict);
  });

  app.post<{ Body: UserPromptSubmitPayload }>('/v1/gemini/before-agent', async (req) => {
    sessions.addPrompt(req.body.session_id, req.body.prompt, 'gemini_hook');
    return {};
  });
}

export function toGeminiCheckRequest(p: PreToolUsePayload): CheckRequest | null {
  const base = { session_id: p.session_id, source: 'gemini_hook' as const, agent: 'gemini-cli' as const, cwd: p.cwd };
  const input = p.tool_input ?? {};
  const file: string = input.file_path ?? input.path ?? input.absolute_path;

  switch (p.tool_name) {
    case 'run_shell_command':
      return { ...base, tool: 'bash', command: String(input.command ?? ''), intent: input.description ?? null };
    case 'write_file':
      return { ...base, tool: 'write', command: `write ${file}`, edit: writeEdit(p.cwd, file, input.content), intent: null };
    case 'replace':
    case 'edit':
    case 'edit_file':
      return {
        ...base,
        tool: 'edit',
        command: `edit ${file}`,
        edit: replaceEdit(p.cwd, file, [{ old_string: input.old_string, new_string: input.new_string, replace_all: (input.expected_replacements ?? 1) > 1 }]),
        intent: null,
      };
    default:
      return null;
  }
}

/** Gemini's output format. No decision = Gemini's normal flow; "allow" only after the developer confirmed (FR-H5). */
export function toGeminiOutput(v: VerdictResponse) {
  if (v.verdict === 'allow' || v.verdict === 'warn') {
    return v.human_confirmed ? { decision: 'allow', reason: 'Confirmed by the developer in nocap' } : {};
  }
  const reason = v.verdict === 'ask' ? `nocap needs the developer to confirm this first. ${v.reason_for_agent}` : v.reason_for_agent;
  return { decision: 'deny', reason };
}
