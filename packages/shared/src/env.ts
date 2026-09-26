// Loads the repo's .env (gitignored) into process.env. Walks up from cwd to find it.
// Existing environment variables win. No-op when there is no .env.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function loadEnv(start = process.cwd()) {
  for (let dir = start; ; dir = dirname(dir)) {
    const file = join(dir, '.env');
    if (existsSync(file)) return process.loadEnvFile(file);
    if (dirname(dir) === dir) return;
  }
}
