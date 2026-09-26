// In-process event bus feeding WS /v1/stream (B2).
import type { StreamEvent } from '@nocap/shared';

type Listener = (e: StreamEvent) => void;
const listeners = new Set<Listener>();

export const bus = {
  emit(e: StreamEvent) {
    for (const l of listeners) l(e);
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
