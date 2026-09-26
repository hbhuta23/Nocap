// Per-session task store (B5). Local JSONL is the offline audit fallback.
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TaskRequest } from '@nocap/shared';
import { bus } from './bus';

const tasks = new Map<string, string>();

export const sessions = {
  getTask(sessionId: string): string | null {
    return tasks.get(sessionId) ?? null;
  },
  setTask(sessionId: string, task: string, source: TaskRequest['source']) {
    tasks.set(sessionId, task);
    bus.emit({ type: 'task.updated', session_id: sessionId, task, source, at: Date.now() });
    void appendFile(join(process.cwd(), '.nocap.sessions.jsonl'), `${JSON.stringify({ session_id: sessionId, task, source, updated_at: Date.now() })}\n`, 'utf8').catch(() => undefined);
  },
};
