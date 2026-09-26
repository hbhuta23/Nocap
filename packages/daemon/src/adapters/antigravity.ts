// Google Antigravity CLI (`agy`) hook adapter. Owner: Role A.
// Config: <workspace>/.agents/hooks.json, as named groups of FLAT entries (the docs' nested `hooks: [...]`
// form fails to parse in 1.2.11: "command hook must specify 'command'"). Tool hooks need a `matcher`.
// Events used: PreToolUse (tool calls) and PreInvocation (before each model call; carries NO prompt text,
// so the developer's prompt is read from the transcript file it points to).
// PreToolUse stdin: { toolCall: { name, args }, conversationId, workspacePaths, transcriptPath, ... }
// Output: {} = normal flow; { decision: "deny" | "ask" | "allow", reason }.
// Tool args verified against a real 1.2.11 transcript (fixtures/hooks/antigravity/, A0.2).
// TODO(A0.2): record one raw PreToolUse payload to confirm the stdin wrapper matches the docs.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import type { FastifyInstance } from 'fastify';
import type { CheckRequest, VerdictResponse } from '@nocap/shared';
import { sessions } from '../sessions';
import { checkFromHook } from './claude';
import { replaceEdit, writeEdit } from './edits';

export interface AntigravityBase {
  conversationId: string;
  workspacePaths?: string[];
  transcriptPath?: string;
}

export interface AntigravityPreToolUse extends AntigravityBase {
  toolCall: { name: string; args: Record<string, any> };
}

export const ANTIGRAVITY_TOOLS = ['run_command', 'write_to_file', 'replace_file_content', 'multi_replace_file_content'];

/** The transcript says `run_command`; agy's runtime log says `RunCommand`. Accept both: RunCommand → run_command. */
export function toolName(name: string | undefined): string {
  return (name ?? '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

export function registerAntigravityRoutes(app: FastifyInstance) {
  app.post<{ Body: AntigravityPreToolUse }>('/v1/antigravity/pre-tool-use', async (req) => {
    const check = toAntigravityCheckRequest(req.body);
    if (!check) return {};
    const verdict = await checkFromHook(check);
    return toAntigravityOutput(verdict);
  });

  app.post<{ Body: AntigravityBase }>('/v1/antigravity/pre-invocation', async (req) => {
    const prompt = latestPrompt(req.body.transcriptPath);
    // PreInvocation fires before every model call in a turn; only record each new prompt once.
    if (prompt && lastPrompt.get(req.body.conversationId) !== prompt) {
      lastPrompt.set(req.body.conversationId, prompt);
      sessions.addPrompt(req.body.conversationId, prompt, 'antigravity_hook', req.body.workspacePaths?.[0]);
    }
    return {};
  });
}

const lastPrompt = new Map<string, string>();

export function toAntigravityCheckRequest(p: AntigravityPreToolUse): CheckRequest | null {
  const args = p.toolCall?.args ?? {};
  const cwd: string = args.Cwd ?? p.workspacePaths?.[0] ?? process.cwd();
  const base = { session_id: p.conversationId, source: 'antigravity_hook' as const, agent: 'antigravity' as const, cwd };
  // Antigravity describes each tool call ("Listing src directory"): the agent's intent, for free.
  const intent: string | null = args.toolAction ?? args.Description ?? args.Instruction ?? args.toolSummary ?? null;
  const file: string = args.TargetFile;

  switch (toolName(p.toolCall?.name)) {
    case 'run_command':
      return { ...base, tool: 'bash', command: String(args.CommandLine ?? ''), intent };
    case 'write_to_file':
      return { ...base, tool: 'write', command: `write ${file}`, edit: writeEdit(cwd, file, args.CodeContent), intent };
    case 'replace_file_content':
      return {
        ...base,
        tool: 'edit',
        command: `edit ${file}`,
        edit: replaceEdit(cwd, file, [{ old_string: args.TargetContent, new_string: args.ReplacementContent, replace_all: Boolean(args.AllowMultiple) }]),
        intent,
      };
    case 'multi_replace_file_content':
      return {
        ...base,
        tool: 'edit',
        command: `edit ${file}`,
        edit: replaceEdit(
          cwd,
          file,
          (args.ReplacementChunks ?? []).map((c: any) => ({ old_string: c.TargetContent, new_string: c.ReplacementContent, replace_all: Boolean(c.AllowMultiple) })),
        ),
        intent,
      };
    default:
      return null;
  }
}

/** No decision = Antigravity's normal flow; "allow" only after the developer confirmed in nocap (FR-H5). */
export function toAntigravityOutput(v: VerdictResponse) {
  if (v.verdict === 'allow' || v.verdict === 'warn') {
    return v.human_confirmed ? { decision: 'allow', reason: 'Confirmed by the developer in nocap' } : {};
  }
  return { decision: v.verdict === 'ask' ? 'ask' : 'deny', reason: v.reason_for_agent };
}

/** The developer's latest prompt: the last <USER_REQUEST> in the transcript's USER_INPUT lines. */
export function latestPrompt(transcriptPath: string | undefined): string | null {
  if (!transcriptPath) return null;
  let text: string;
  try {
    text = readFileSync(transcriptPath.replace(/^~(?=\/)/, homedir()), 'utf8');
  } catch {
    return null;
  }
  let prompt: string | null = null;
  for (const line of text.split('\n')) {
    if (!line.includes('USER_INPUT')) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'USER_INPUT' || typeof entry.content !== 'string') continue;
      const requests = [...entry.content.matchAll(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/g)];
      if (requests.length) prompt = requests[requests.length - 1][1];
    } catch {
      // partial line while the agent is writing: skip
    }
  }
  return prompt;
}
