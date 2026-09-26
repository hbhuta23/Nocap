// .nocap.yml loader (B4). Owner: Role B.
// Parsed with the `yaml` library: the earlier hand-written parser couldn't read lists of maps or plain
// lists (`sensitive_rows`, `rules`), so those were silently ignored. Malformed input falls back to defaults.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import YAML from 'yaml';
import type { NocapConfig } from '@nocap/shared';
import { DEFAULT_TEST_GLOBS } from '@nocap/shared';

export const defaultConfig: NocapConfig = {
  version: 1,
  human_check: 'risky',
  budget: { per_command_usd: 5, per_session_usd: 20 },
  tests: { globs: DEFAULT_TEST_GLOBS },
  database: { url_env: 'DATABASE_URL', protected_tables: [], sensitive_rows: [], redact_columns: [] },
  production: { hosts: [], kube_contexts: [] },
  network: { allow_domains: [] },
  rules: [],
};

/** Finds .nocap.yml in cwd or the nearest parent (agents often run commands from a subfolder). */
export function findConfigFile(cwd: string): string | null {
  for (let dir = cwd; ; dir = dirname(dir)) {
    const file = join(dir, '.nocap.yml');
    if (existsSync(file)) return file;
    if (dirname(dir) === dir) return null;
  }
}

export function loadConfig(cwd: string): NocapConfig {
  const file = findConfigFile(cwd);
  if (!file) return structuredClone(defaultConfig);
  try {
    const parsed = (YAML.parse(readFileSync(file, 'utf8')) ?? {}) as Partial<NocapConfig>;
    return mergeConfig(parsed);
  } catch {
    return structuredClone(defaultConfig);
  }
}

function mergeConfig(value: Partial<NocapConfig>): NocapConfig {
  return {
    ...defaultConfig,
    ...value,
    budget: { ...defaultConfig.budget, ...(value.budget ?? {}) },
    tests: { ...defaultConfig.tests, ...(value.tests ?? {}) },
    database: { ...defaultConfig.database, ...(value.database ?? {}) },
    production: { ...defaultConfig.production, ...(value.production ?? {}) },
    network: { ...defaultConfig.network, ...(value.network ?? {}) },
    rules: (Array.isArray(value.rules) ? value.rules : []).filter((r): r is string => typeof r === 'string' && r.trim() !== '').map((r) => r.trim()),
  };
}
