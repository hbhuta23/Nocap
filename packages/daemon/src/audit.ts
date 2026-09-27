// Local audit log (B15): one JSON line per check and pop-up outcome, in ~/.nocap/logs/<project>/audit.jsonl.
// A MongoDB sink can be added here later (optional, a team's own Atlas URI); the local file stays the default.
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logDir } from './logs';

export async function audit(cwd: string, event: unknown): Promise<void> {
  try {
    await appendFile(join(logDir(cwd), 'audit.jsonl'), `${JSON.stringify(event)}\n`, 'utf8');
  } catch {
    // Audit logging must never delay or change a verdict.
  }
}
