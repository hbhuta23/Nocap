// Per-session task store (B5). In memory, TODO: write through to MongoDB `sessions`.
import type { TaskRequest } from '@nocap/shared';
import { bus } from './bus';

const tasks = new Map<string, string>();

export const sessions = {
  getTask(sessionId: string): string | null {
    return tasks.get(sessionId) ?? null;
  },
  setTask(sessionId: string, task: string, source: TaskRequest['source']) {
    // TODO: follow-up prompts ("yes do it", "now run it") should not replace the real task.
    tasks.set(sessionId, task);
    bus.emit({ type: 'task.updated', session_id: sessionId, task, source, at: Date.now() });
  },
};
