// Claude Code hook adapter (A1, A2). Owner: Role A.
// packages/shims/hooks/nocap-hook.sh forwards the raw hook JSON here, so all mapping lives in
// testable TypeScript instead of shell. Verify the payload shapes against fixtures/hooks/ (A0.2).

import type { FastifyInstance } from 'fastify';
import type { CheckRequest, VerdictResponse } from '@nocap/shared';
import { runCheck } from '../pipeline';
import { sessions } from '../sessions';

interface HookBase {
  session_id: string;
  cwd: string;
  hook_event_name: string;
  permission_mode?: string;
}

interface PreToolUsePayload extends HookBase {
  tool_name: string;
  tool_input: Record<string, any>;
}

interface UserPromptSubmitPayload extends HookBase {
  prompt: string;
}

export function registerClaudeRoutes(app: FastifyInstance) {
  app.post<{ Body: PreToolUsePayload }>('/v1/claude/pre-tool-use', async (req) => {
    const check = toCheckRequest(req.body);
    if (!check) return {}; // tool we don't guard: no decision, Claude Code's normal flow
    const verdict = await runCheck(check);
    return toHookOutput(verdict);
  });

  app.post<{ Body: UserPromptSubmitPayload }>('/v1/claude/user-prompt-submit', async (req) => {
    sessions.setTask(req.body.session_id, req.body.prompt, 'claude_hook');
    return {};
  });
}

export function toCheckRequest(p: PreToolUsePayload): CheckRequest | null {
  const base = { session_id: p.session_id, source: 'claude_hook' as const, agent: 'claude-code' as const, cwd: p.cwd };
  const input = p.tool_input ?? {};

  switch (p.tool_name) {
    case 'Bash':
      return { ...base, tool: 'bash', command: input.command, intent: input.description ?? null };
    case 'Edit':
      return {
        ...base,
        tool: 'edit',
        command: `edit ${input.file_path}`,
        edit: { file: input.file_path, old: input.old_string, new: input.new_string },
        intent: null,
      };
    case 'MultiEdit':
      // TODO(A1): apply all edits to the file content to build a real old/new pair.
      return {
        ...base,
        tool: 'edit',
        command: `edit ${input.file_path}`,
        edit: {
          file: input.file_path,
          old: (input.edits ?? []).map((e: any) => e.old_string).join('\n'),
          new: (input.edits ?? []).map((e: any) => e.new_string).join('\n'),
        },
        intent: null,
      };
    case 'Write':
      // TODO(A1): read the current file so `old` is the real previous content.
      return {
        ...base,
        tool: 'write',
        command: `write ${input.file_path}`,
        edit: { file: input.file_path, old: '', new: input.content },
        intent: null,
      };
    default:
      return null;
  }
}

/**
 * §6.4. Plain allow returns NO decision so Claude Code's own permission prompt still applies;
 * we only return "allow" when the human already confirmed in nocap's pop-up (FR-H5).
 */
export function toHookOutput(v: VerdictResponse, humanConfirmed = false) {
  if (v.verdict === 'allow' || v.verdict === 'warn') {
    if (!humanConfirmed) return v.verdict === 'warn' ? { systemMessage: `nocap warning: ${v.headline}` } : {};
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Confirmed by the developer in nocap',
      },
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: v.verdict === 'ask' ? 'ask' : 'deny',
      permissionDecisionReason: v.reason_for_agent,
    },
  };
}
