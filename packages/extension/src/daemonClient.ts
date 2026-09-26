import { DAEMON_HOST, DAEMON_PORT } from '@nocap/shared';

const base = `http://${DAEMON_HOST}:${DAEMON_PORT}`;

export const daemon = {
  base,
  async get<T>(path: string): Promise<T> {
    const res = await fetch(base + path);
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    return (await res.json()) as T;
  },
  async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    return (await res.json()) as T;
  },
  async healthy(): Promise<boolean> {
    try {
      await fetch(base + '/v1/health', { signal: AbortSignal.timeout(500) });
      return true;
    } catch {
      return false;
    }
  },
};
