// Shim adapter (A4, A5). Owner: Role A.
// Shims POST url-encoded fields (bin, cwd, intent, session, arg×N) so bash needs no JSON quoting.
// Response is plain text: line 1 = verdict, rest = reason_for_agent.

import type { FastifyInstance } from 'fastify';
import { quote } from 'shell-quote';
import type { CheckRequest } from '@nocap/shared';
import { runCheck } from '../pipeline';
import { checkedByHook } from './recent';

interface ShimBody {
  bin: string;
  cwd: string;
  intent?: string;
  session?: string;
  arg?: string | string[];
}

export function registerShimRoutes(app: FastifyInstance) {
  app.post<{ Body: ShimBody }>('/v1/shim', async (req, reply) => {
    const b = req.body;
    const args = b.arg === undefined ? [] : Array.isArray(b.arg) ? b.arg : [b.arg];
    const check: CheckRequest = {
      session_id: b.session || 'shim-unknown',
      source: 'shim',
      agent: 'unknown',
      cwd: b.cwd,
      tool: 'bash',
      command: quote([b.bin, ...args]),
      intent: b.intent || null,
    };

    reply.type('text/plain');
    // The agent's native hook (Claude Code, Codex, Gemini) already checked this command: don't check or prompt twice.
    if (checkedByHook(check.cwd, check.command)) return 'allow\n';

    const v = await runCheck(check);
    let reason = v.reason_for_agent;
    // A5: force the agent to explain itself when it gave no intent.
    if (v.verdict !== 'allow' && v.verdict !== 'warn' && !check.intent) {
      reason += `\nnocap: this command needs a stated intent. Re-run it as NOCAP_INTENT="<why you are running it>" ${check.command}`;
    }
    return `${v.verdict}\n${reason}`;
  });
}
