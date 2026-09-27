// Claude Code hook adapter (A1, A2). Owner: Role A.
// packages/shims/hooks/nocap-hook.sh forwards the raw hook JSON here, so all mapping lives in
// testable TypeScript instead of shell. Payload shapes verified against fixtures/hooks/claude-code (A0.2).

import type { FastifyInstance } from 'fastify';
import type { CheckRequest, VerdictResponse } from '@nocap/shared';
import { runCheck } from '../pipeline';
import { sessions } from '../sessions';
import { replaceEdit, writeEdit } from './edits';
import { rememberHookCheck } from './recent';

export interface HookBase {
  session_id: string;
  cwd: string;
  hook_event_name: string;
  permission_mode?: string;
}

export interface PreToolUsePayload extends HookBase {
  tool_name: string;
  tool_input: Record<string, any>;
}

export interface UserPromptSubmitPayload extends HookBase {
  prompt: string;
}

export function registerClaudeRoutes(app: FastifyInstance) {
  app.post<{ Body: PreToolUsePayload }>('/v1/claude/pre-tool-use', async (req) => {
    const check = toCheckRequest(req.body);
    if (!check) return {}; // tool we don't guard: no decision, Claude Code's normal flow
    const verdict = await checkFromHook(check);
    return toHookOutput(verdict, verdict.human_confirmed);
  });

  app.post<{ Body: UserPromptSubmitPayload }>('/v1/claude/user-prompt-submit', async (req) => {
    sessions.addPrompt(req.body.session_id, req.body.prompt, 'claude_hook', req.body.cwd);
    return {};
  });
}

/** Runs a check that came from a native hook, and remembers passed commands so the shim doesn't re-check them. */
export async function checkFromHook(check: CheckRequest): Promise<VerdictResponse> {
  const verdict = await runCheck(check);
  if (check.tool === 'bash' && (verdict.verdict === 'allow' || verdict.verdict === 'warn')) rememberHookCheck(check.cwd, check.command);
  return verdict;
}

export function toCheckRequest(p: PreToolUsePayload): CheckRequest | null {
  const base = { session_id: p.session_id, source: 'claude_hook' as const, agent: 'claude-code' as const, cwd: p.cwd };
  const input = p.tool_input ?? {};

  switch (p.tool_name) {
    case 'Bash':
      // Claude Code writes a description for every Bash call: that is the agent's intent, for free.
      return { ...base, tool: 'bash', command: input.command, intent: input.description ?? null };
    case 'Edit':
      return {
        ...base,
        tool: 'edit',
        command: `edit ${input.file_path}`,
        edit: replaceEdit(p.cwd, input.file_path, [input as { old_string: string; new_string: string; replace_all?: boolean }]),
        intent: null,
      };
    case 'MultiEdit':
      return {
        ...base,
        tool: 'edit',
        command: `edit ${input.file_path}`,
        edit: replaceEdit(p.cwd, input.file_path, input.edits ?? []),
        intent: null,
      };
    case 'Write':
      return { ...base, tool: 'write', command: `write ${input.file_path}`, edit: writeEdit(p.cwd, input.file_path, input.content), intent: null };
    default:
      return null;
  }
}

/**
 * §6.4. Plain allow returns NO decision so Claude Code's own permission prompt still applies;
 * we only return "allow" when the human already confirmed in Nocap's pop-up (FR-H5).
 * Codex uses the same output format.
 */
export function toHookOutput(v: VerdictResponse, humanConfirmed = false) {
  if (v.verdict === 'allow' || v.verdict === 'warn') {
    if (!humanConfirmed) return v.verdict === 'warn' ? { systemMessage: `Nocap warning: ${v.headline}` } : {};
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Confirmed by the developer in Nocap',
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
