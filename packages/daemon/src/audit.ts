import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function audit(cwd: string, event: unknown): Promise<void> {
  try {
    await appendFile(join(cwd, '.nocap.audit.jsonl'), `${JSON.stringify(event)}\n`, 'utf8');
  } catch {
    // Audit logging must never delay or change a verdict.
  }
}