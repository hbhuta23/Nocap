// Per-session task store (B5, A2). Local JSONL is the offline audit fallback.
//
// Agents send every prompt (UserPromptSubmit), but not every prompt is a new task: "yes go ahead"
// must not replace "clean up the test users". So:
//   - short follow-ups (under 4 words, or a plain confirmation) are kept as context, never the task
//   - a substantive prompt becomes the task; the previous task is kept as "earlier" context
//   - a task set explicitly in the panel or CLI replaces everything
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TaskRequest } from '@nocap/shared';
import { bus } from './bus';

interface SessionTask {
  task: string;
  earlier: string | null;
  followUps: string[];
}

const sessionTasks = new Map<string, SessionTask>();
const MAX_FOLLOW_UPS = 3;
const CONFIRMATION = /^(y|yes|yep|yeah|ok|okay|sure|go|go ahead|do it|continue|proceed|approved?|lgtm|sounds good|please do|yes please)[.!]*$/i;

/** Short prompts starting like this refine the current task ("use the test.local ones") rather than replace it. */
const REFINEMENT = /^(use|only|instead|but|actually|also|and|just|no|not|try|with|without|rather|make it|keep|skip|except)\b/i;

export function isFollowUp(prompt: string): boolean {
  const text = prompt.trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  return CONFIRMATION.test(text) || words < 4 || (words < 10 && REFINEMENT.test(text));
}

/** The task as the judge sees it: current task, plus earlier task and recent follow-ups as context. */
function describe(t: SessionTask): string {
  let out = t.task;
  if (t.followUps.length) out += `\n(Follow-ups from the developer since then: ${t.followUps.map((f) => `"${f}"`).join('; ')})`;
  if (t.earlier) out += `\n(Earlier task in this session: "${t.earlier}")`;
  return out;
}

export const sessions = {
  getTask(sessionId: string): string | null {
    const t = sessionTasks.get(sessionId);
    return t ? describe(t) : null;
  },

  /** Explicit task from the panel or CLI: replaces everything. */
  setTask(sessionId: string, task: string, source: TaskRequest['source']) {
    sessionTasks.set(sessionId, { task, earlier: null, followUps: [] });
    publish(sessionId, source);
  },

  /** A prompt the developer sent to the agent (UserPromptSubmit / BeforeAgent). */
  addPrompt(sessionId: string, prompt: string, source: TaskRequest['source']) {
    const text = prompt.trim();
    if (!text) return;
    const current = sessionTasks.get(sessionId);
    if (current && isFollowUp(text)) {
      current.followUps = [...current.followUps, text].slice(-MAX_FOLLOW_UPS);
    } else if (current) {
      sessionTasks.set(sessionId, { task: text, earlier: current.task, followUps: [] });
    } else {
      // First prompt of the session is the task, even if short.
      sessionTasks.set(sessionId, { task: text, earlier: null, followUps: [] });
    }
    publish(sessionId, source);
  },
};

function publish(sessionId: string, source: TaskRequest['source']) {
  const task = sessions.getTask(sessionId) ?? '';
  bus.emit({ type: 'task.updated', session_id: sessionId, task, source, at: Date.now() });
  void appendFile(join(process.cwd(), '.nocap.sessions.jsonl'), `${JSON.stringify({ session_id: sessionId, task, source, updated_at: Date.now() })}\n`, 'utf8').catch(() => undefined);
}
