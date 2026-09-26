// Codex CLI hook adapter. Owner: Role A.
// Codex hooks are Claude-compatible: same event names (PreToolUse, UserPromptSubmit), same stdin fields,
// same `hookSpecificOutput.permissionDecision` output. Differences: file edits arrive as `apply_patch`.
// Source: https://learn.chatgpt.com/docs/hooks (fetched 2026-09-26).
// TODO(A0.2): verify against real payloads in fixtures/hooks/codex/ once Codex is installed.

import type { FastifyInstance } from 'fastify';
import type { CheckRequest } from '@nocap/shared';
import { sessions } from '../sessions';
import { checkFromHook, toHookOutput, type PreToolUsePayload, type UserPromptSubmitPayload } from './claude';
import { patchEdits, pickEdit } from './edits';

export function registerCodexRoutes(app: FastifyInstance) {
  app.post<{ Body: PreToolUsePayload }>('/v1/codex/pre-tool-use', async (req) => {
    const check = toCodexCheckRequest(req.body);
    if (!check) return {};
    const verdict = await checkFromHook(check);
    return toHookOutput(verdict, verdict.human_confirmed);
  });

  app.post<{ Body: UserPromptSubmitPayload }>('/v1/codex/user-prompt-submit', async (req) => {
    sessions.addPrompt(req.body.session_id, req.body.prompt, 'codex_hook', req.body.cwd);
    return {};
  });
}

export function toCodexCheckRequest(p: PreToolUsePayload): CheckRequest | null {
  const base = { session_id: p.session_id, source: 'codex_hook' as const, agent: 'codex' as const, cwd: p.cwd };
  const input = p.tool_input ?? {};

  if (p.tool_name === 'Bash') {
    const command = Array.isArray(input.command) ? input.command.join(' ') : String(input.command ?? '');
    return { ...base, tool: 'bash', command, intent: input.description ?? input.justification ?? null };
  }

  if (p.tool_name === 'apply_patch') {
    // The patch text's field name isn't documented; take whichever string holds the patch.
    const patch = [input.patch, input.input, input.command, ...Object.values(input)].find(
      (v): v is string => typeof v === 'string' && v.includes('*** Begin Patch'),
    );
    const edits = patch ? patchEdits(p.cwd, patch) : [];
    const edit = pickEdit(edits);
    if (!edit) return null;
    return { ...base, tool: 'edit', command: `apply_patch ${edits.map((e) => e.file).join(' ')}`, edit, intent: null };
  }

  return null;
}
