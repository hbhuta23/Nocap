import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
};

export function loadConfig(cwd: string): NocapConfig {
  const file = join(cwd, '.nocap.yml');
  if (!existsSync(file)) return structuredClone(defaultConfig);
  try {
    const parsed = parseSimpleYaml(readFileSync(file, 'utf8')) as Partial<NocapConfig>;
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
  };
}

// Small YAML subset covering the committed .nocap.yml contract. It deliberately
// accepts only scalars, maps, and arrays; malformed input falls back to defaults.
function parseSimpleYaml(source: string): unknown {
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; value: Record<string, unknown> | unknown[] }> = [{ indent: -1, value: root }];
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    const indent = raw.length - raw.trimStart().length;
    const match = line.trim().match(/^([^:]+):(?:\s*(.*))?$/);
    if (!match) continue;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].value;
    if (Array.isArray(parent)) continue;
    const key = match[1].trim();
    const text = match[2]?.trim() ?? '';
    if (!text) {
      const child: Record<string, unknown> = {};
      parent[key] = child;
      stack.push({ indent, value: child });
    } else parent[key] = scalar(text);
  }
  return root;
}

function scalar(text: string): unknown {
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (text.startsWith('[') && text.endsWith(']')) return text.slice(1, -1).split(',').map((v) => v.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  return text.replace(/^['"]|['"]$/g, '');
}