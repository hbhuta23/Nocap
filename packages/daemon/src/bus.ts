// In-process event bus feeding WS /v1/stream (B2), plus a short history for GET /v1/recent so the panel
// can show recent activity after it (or VS Code) reloads.
import type { StreamEvent } from '@nocap/shared';

type Listener = (e: StreamEvent) => void;
/** Each listener is a VS Code window (or its panel) and the workspace folders it has open. */
const listeners = new Map<Listener, string[]>();

/** True when `cwd` is `root` or inside it. */
export function within(cwd: string, root: string) {
  const r = root.replace(/\/+$/, '');
  return cwd === r || cwd.startsWith(r + '/');
}

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
    for (const l of listeners.keys()) l(e);
  },
  subscribe(l: Listener, roots: string[] = []) {
    listeners.set(l, roots);
    return () => listeners.delete(l);
  },
  /** Is a window with this workspace open? If not, its pop-ups go to every window. */
  claimed(cwd: string) {
    return [...listeners.values()].some((roots) => roots.some((root) => within(cwd, root)));
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
