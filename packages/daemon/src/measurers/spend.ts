// Runaway spend (B10, FR-S1..S5). The AI reads, math decides. Owner: Role B (built by Role A).
//
//   trigger  a python/node/tsx/bun/deno run of a script that (or a local file it imports) uses an LLM SDK or API
//   FR-S1    Gemini reads the script: provider, calls per item (each with its own model), where the loop's items come from
//   FR-S2    the real item count, deterministically: a READ ONLY count(*) of the script's query, or the file's lines
//   FR-S3    tokens per call from up to 20 real items (characters ÷ 4)
//   FR-S4    prices.json (USD per 1M tokens, with the date they were checked)
//   FR-S5    items × Σ(calls) as a low–high range; unknown loop source → "can't estimate" (the judge asks the human)

import { readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { Client } from 'pg';
import { parse } from 'shell-quote';
import { LlmJudge, type SpendExtraction } from '@nocap/judge';
import type { CheckRequest, Ctx, Fact, Measurement, Measurer } from '@nocap/shared';
import prices from './prices.json';

const judge = new LlmJudge();

const LLM_USE = /\b(openai|anthropic|google\.genai|google\.generativeai|@google\/genai|GoogleGenAI|cohere|voyageai|api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com)\b/i;
const RUNNERS = new Set(['python', 'python3', 'node', 'tsx', 'bun', 'deno', 'ts-node']);
const SCRIPT_EXT = /\.(py|m?js|cjs|ts|mts)$/;

// ---------- trigger ----------

/** The script a command runs: `python scripts/x.py`, `node a.js`, `npx tsx a.ts`, `bun run a.ts`. */
export function scriptPath(command: string, cwd: string): string | null {
  const tokens = parse(command, (k) => `$${k}`).filter((t): t is string => typeof t === 'string');
  for (let i = 0; i < tokens.length; i++) {
    const bin = tokens[i].split('/').pop() ?? '';
    if (!RUNNERS.has(bin) && !(bin === 'npx' && RUNNERS.has(tokens[i + 1] ?? ''))) continue;
    const file = tokens.slice(i + 1).find((t) => SCRIPT_EXT.test(t));
    if (file) return isAbsolute(file) ? file : join(cwd, file);
  }
  return null;
}

const readCache = new Map<string, { mtime: number; text: string }>();
function readScript(path: string): string | null {
  try {
    const mtime = statSync(path).mtimeMs;
    const hit = readCache.get(path);
    if (hit && hit.mtime === mtime) return hit.text;
    const text = readFileSync(path, 'utf8');
    readCache.set(path, { mtime, text });
    return text;
  } catch {
    return null;
  }
}

/** The script plus the local modules it imports, one level deep (the BRD trigger). */
function scriptWithImports(path: string): string | null {
  const main = readScript(path);
  if (main === null) return null;
  const dir = dirname(path);
  const specs = [
    ...[...main.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]|require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)].map((m) => m[1] ?? m[2]),
    ...[...main.matchAll(/^\s*(?:from\s+\.?([\w.]+)\s+import|import\s+([\w.]+))/gm)].map((m) => `./${(m[1] ?? m[2]).split('.').pop()}`),
  ];
  const parts = [main];
  for (const spec of specs) {
    for (const ext of ['', '.py', '.ts', '.js', '.mjs']) {
      const text = readScript(join(dir, spec + ext));
      if (text !== null) {
        parts.push(text);
        break;
      }
    }
  }
  return parts.join('\n\n');
}

/** Cheap enough for the classifier: a cached file read and a regex. */
export function runsLlmScript(req: CheckRequest): boolean {
  if (req.tool !== 'bash') return false;
  const path = scriptPath(req.command, req.cwd);
  const code = path ? scriptWithImports(path) : null;
  return Boolean(code && LLM_USE.test(code));
}

// ---------- pricing ----------

type Price = { input: number; output: number };
const models = prices.models as Record<string, Price>;

export function priceFor(model: string | null, provider: string): { key: string; price: Price; exact: boolean } {
  const id = (model ?? '').toLowerCase();
  if (models[id]) return { key: id, price: models[id], exact: true };
  const partial = Object.keys(models)
    .filter((k) => id.startsWith(k) || id.includes(k))
    .sort((a, b) => b.length - a.length)[0];
  if (partial) return { key: partial, price: models[partial], exact: false };
  const fallback = (prices.provider_default as Record<string, string>)[provider] ?? prices.provider_default.unknown;
  return { key: fallback, price: models[fallback], exact: false };
}

// ---------- FR-S2 / FR-S3: real counts and token samples ----------

async function countSqlItems(query: string, ctx: Ctx): Promise<{ items: number; sampleTexts: string[] } | string> {
  const url = process.env[ctx.config.database?.url_env ?? 'DATABASE_URL'];
  if (!url) return 'no database URL to count the items';
  const sql = query.trim().replace(/;\s*$/, '');
  if (sql.includes(';') || !/^\s*(select|with)\b/i.test(sql)) return 'the loop query is not a single SELECT';
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '3s'");
    const items = Number((await client.query(`SELECT count(*) AS n FROM (${sql}) nocap_q`)).rows[0].n);
    const rows = (await client.query(`SELECT * FROM (${sql}) nocap_q LIMIT 20`)).rows;
    return { items, sampleTexts: rows.map((r) => Object.values(r).filter((v) => typeof v === 'string').join(' ')) };
  } catch (err) {
    return `could not count the items (${err instanceof Error ? err.message : String(err)})`;
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

function countFileItems(path: string): { items: number; sampleTexts: string[] } | string {
  try {
    const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim());
    return { items: lines.length, sampleTexts: lines.slice(0, 20) };
  } catch {
    return `could not read ${path}`;
  }
}

// ---------- the measurer ----------

export async function measureSpend(req: CheckRequest, ctx: Ctx): Promise<Measurement> {
  const path = scriptPath(req.command, req.cwd);
  const code = path ? scriptWithImports(path) : null;
  const budget = ctx.config.budget;
  const cantEstimate = (why: string, extra: object = {}): Measurement => ({
    facts: [{ label: 'Estimated cost', value: `can't estimate: ${why}`, severity: 'medium' }],
    judgeContext: { script: path, confidence: "can't estimate", reason: why, budget_per_command_usd: budget.per_command_usd, budget_per_session_usd: budget.per_session_usd, ...extra },
  });
  if (!path || !code) return cantEstimate('could not read the script');

  // FR-S1: structure only, from the model.
  const x: SpendExtraction | null = await judge.extractSpend(code, path);
  if (!x) return cantEstimate('the judge could not read the script');

  // FR-S2 + FR-S3
  const src = x.loop_source;
  let counted: { items: number; sampleTexts: string[] } | string;
  let sourceText: string;
  if (src.kind === 'sql' && src.query) {
    counted = await countSqlItems(src.query, ctx);
    sourceText = src.query;
  } else if (src.kind === 'file' && src.path) {
    const filePath = isAbsolute(src.path) ? src.path : join(req.cwd, src.path);
    counted = countFileItems(filePath);
    sourceText = `lines of ${src.path}`;
  } else if ((src.kind === 'list' || src.kind === 'range') && src.count) {
    counted = { items: src.count, sampleTexts: [] };
    sourceText = `${src.kind} of ${src.count}`;
  } else {
    return cantEstimate('the number of items comes from something nocap cannot count (for example an API it pages through)', { provider: x.provider, loop_source: 'unknown' });
  }
  if (typeof counted === 'string') return cantEstimate(counted, { provider: x.provider, loop_source: sourceText });

  const { items, sampleTexts } = counted;
  const avgChars = sampleTexts.length ? sampleTexts.reduce((a, t) => a + t.length, 0) / sampleTexts.length : 2000;
  const promptOverhead = 50;
  const inputTokens = Math.ceil(avgChars / 4) + promptOverhead;

  // FR-S4 + FR-S5: sum every call made per item. Output is unknown up front: low assumes 30% of the cap
  // (or 300 tokens), high assumes the full cap (or 1,000 tokens).
  const calls = x.per_item_calls?.length ? x.per_item_calls : Array.from({ length: Math.max(1, x.calls_per_item) }, () => ({ model: x.model, kind: 'chat' as const, max_output_tokens: x.max_output_tokens }));
  let low = 0;
  let high = 0;
  const priced: string[] = [];
  let allExact = true;
  for (const call of calls) {
    const { key, price, exact } = priceFor(call.model, x.provider);
    allExact &&= exact;
    const outMax = call.kind === 'embedding' ? 0 : call.max_output_tokens ?? 1000;
    const outLow = call.kind === 'embedding' ? 0 : call.max_output_tokens ? call.max_output_tokens * 0.3 : 300;
    low += (inputTokens * price.input + outLow * price.output) / 1e6;
    high += (inputTokens * price.input + outMax * price.output) / 1e6;
    priced.push(`${call.model ?? key}${exact ? '' : ` (priced as ${key})`}`);
  }
  const estLow = low * items;
  const estHigh = high * items;
  const confidence = allExact && sampleTexts.length ? 'high' : 'medium';
  const usd = (n: number) => (n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`);

  const facts: Fact[] = [
    { label: 'Estimated cost', value: `${usd(estLow)}–${usd(estHigh)}`, severity: estHigh > budget.per_command_usd ? 'high' : 'low' },
    { label: 'Items', value: `${items.toLocaleString('en-US')} (${sourceText.length > 60 ? sourceText.slice(0, 57) + '…' : sourceText})`, severity: 'medium' },
    { label: 'Calls per item', value: priced.join(' + '), severity: 'low' },
    { label: 'Budget', value: `${usd(budget.per_command_usd)} per command`, severity: 'low' },
  ];

  return {
    facts,
    judgeContext: {
      script: path,
      provider: x.provider,
      per_item_calls: priced,
      loop_source: sourceText,
      items,
      input_tokens_per_call: inputTokens,
      estimate_usd_low: Number(estLow.toFixed(2)),
      estimate_usd_high: Number(estHigh.toFixed(2)),
      confidence,
      prices_checked: prices.checked,
      budget_per_command_usd: budget.per_command_usd,
      budget_per_session_usd: budget.per_session_usd,
      // Read by the policy engine's hard budget rule (BRD §4: hard rules beat the judge).
      estimateUsd: Number(estHigh.toFixed(2)),
    },
  };
}

export const spendMeasurer: Measurer = {
  category: 'spend',
  matches: (req) => req.tool === 'bash' && scriptPath(req.command, req.cwd) !== null,
  measure: measureSpend,
};
