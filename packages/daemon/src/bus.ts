// In-process event bus feeding WS /v1/stream (B2), plus a short history for GET /v1/recent so the panel
// can show recent activity after it (or VS Code) reloads.
import type { StreamEvent } from '@nocap/shared';

type Listener = (e: StreamEvent) => void;
const listeners = new Set<Listener>();

const HISTORY = 100;
const recentChecks: Extract<StreamEvent, { type: 'check.finished' }>[] = [];
const latestTask = new Map<string, Extract<StreamEvent, { type: 'task.updated' }>>();
const humanOutcomes: Extract<StreamEvent, { type: 'human.answered' }>[] = [];

export const bus = {
  emit(e: StreamEvent) {
    if (e.type === 'check.finished') {
      recentChecks.push(e);
      if (recentChecks.length > HISTORY) recentChecks.shift();
    }
    if (e.type === 'task.updated') latestTask.set(e.session_id, e);
    if (e.type === 'human.answered') {
      humanOutcomes.push(e);
      if (humanOutcomes.length > HISTORY) humanOutcomes.shift();
    }
    for (const l of listeners) l(e);
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** Connected stream clients (VS Code windows, panels). Zero means no one can see a pop-up. */
  listenerCount() {
    return listeners.size;
  },
  /** Replayable history, oldest first. */
  recent() {
    return {
      checks: [...recentChecks],
      tasks: [...latestTask.values()].sort((a, b) => a.at - b.at),
      human: [...humanOutcomes],
    };
  },
};
