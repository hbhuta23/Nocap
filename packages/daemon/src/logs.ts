// Where Nocap keeps its local logs: ~/.nocap/logs/<project>-<id>/, never inside the user's repo
// (with auto-protect, a file in every project would end up in commits). Override with NOCAP_HOME.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

/** The project a path belongs to: the nearest folder with .git or .nocap.yml, else the path itself. */
export function projectRoot(cwd: string): string {
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git')) || existsSync(join(dir, '.nocap.yml'))) return dir;
    if (dirname(dir) === dir) return cwd;
  }
}

const made = new Set<string>();

/** Folder for one project's logs, created on first use. */
export function logDir(cwd: string): string {
  const root = projectRoot(cwd);
  const id = createHash('sha256').update(root).digest('hex').slice(0, 8);
  const name = basename(root).replace(/[^\w.-]+/g, '_') || 'workspace';
  const dir = join(process.env.NOCAP_HOME ?? join(homedir(), '.nocap'), 'logs', `${name}-${id}`);
  if (!made.has(dir)) {
    mkdirSync(dir, { recursive: true });
    made.add(dir);
  }
  return dir;
}
