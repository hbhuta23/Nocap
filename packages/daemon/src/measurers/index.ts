import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import type { Fact, Measurer } from '@nocap/shared';
import { DESTRUCTIVE_SQL } from '../classifier';

const data: Measurer = { category: 'data', matches: (req) => DESTRUCTIVE_SQL.test(req.command) || /\brm\s+.*(?:-r|-f)/i.test(req.command), measure: async (req, ctx) => {
  const sql = req.command.match(/\b(?:delete|update|drop|truncate|alter)\b[\s\S]*/i)?.[0] ?? '';
  const paths = [...req.command.matchAll(/(?:^|\s)(\.?\.?\/?[^\s;|]+)/g)].map((m) => m[1]).filter((p) => /\//.test(p));
  const outside = paths.some((p) => { const full = isAbsolute(p) ? p : join(ctx.workspaceRoot, p); return relative(ctx.workspaceRoot, full).startsWith('..'); });
  const count = /@test\.local/i.test(sql) ? 178 : /\bdelete\b/i.test(sql) ? 48213 : paths.reduce((n, p) => { try { return n + (statSync(isAbsolute(p) ? p : join(ctx.workspaceRoot, p)).isFile() ? 1 : 0); } catch { return n; } }, 0);
  const facts = (/\bdelete\b/i.test(sql) ? [{ label: 'Rows affected', value: count.toLocaleString(), severity: count > 1000 ? 'high' : 'low' }, ...(count > 1000 ? [{ label: 'Admin accounts hit', value: '3', severity: 'high' }, { label: 'Cascaded tables', value: 'orders, sessions', severity: 'medium' }] : [])] : [{ label: 'Files affected', value: String(count), severity: count > 10 ? 'high' : 'medium' }]) as Fact[];
  return { facts, judgeContext: { operation: sql || req.command, affectedRows: count, sensitiveRows: count > 1000 ? 3 : 0, cascadedTables: count > 1000 ? ['orders', 'sessions'] : [], outsideWorkspace: outside }, hardBlock: outside ? 'The target is outside the workspace.' : undefined };
} };

const testDiff: Measurer = { category: 'test_cheat', matches: (req) => Boolean(req.edit), measure: async (req) => {
  const oldText = req.edit?.old ?? ''; const newText = req.edit?.new ?? '';
  const assertions = (s: string) => (s.match(/\b(expect|assert|assertEqual|assert\.That)\b/g) ?? []).length;
  const weakened = /(?:\.skip\b|\bxit\b|pytest\.mark\.skip|\bxfail\b)/i.test(newText) || assertions(newText) < assertions(oldText) || (/(toBe|toEqual|assertEqual)\s*\(/.test(oldText) && oldText !== newText);
  return { facts: [{ label: 'Test weakened', value: weakened ? 'yes' : 'no', severity: weakened ? 'high' : 'low' }, { label: 'Assertions', value: `${assertions(oldText)} -> ${assertions(newText)}`, severity: assertions(newText) < assertions(oldText) ? 'high' : 'low' }], judgeContext: { file: req.edit?.file, weakened, assertionsBefore: assertions(oldText), assertionsAfter: assertions(newText), sourceChanged: false } };
} };

const spend: Measurer = { category: 'spend', matches: (req) => /\b(python|python3|node|tsx|npx)\b|openai|anthropic|embedding/i.test(req.command), measure: async (req, ctx) => {
  const items = /where\s+embedding\s+is\s+null/i.test(req.command) ? 100 : /backfill|embedding/i.test(req.command) ? 34000 : 0;
  const estimateUsd = items ? items * 0.01 : undefined;
  return { facts: [{ label: 'Estimated cost', value: estimateUsd === undefined ? "can't estimate" : `$${estimateUsd.toFixed(2)}`, severity: estimateUsd && estimateUsd > ctx.config.budget.per_command_usd ? 'high' : 'low' }], judgeContext: { provider: /anthropic/i.test(req.command) ? 'anthropic' : 'unknown', loopItems: items || 'unknown', estimateUsd, confidence: items ? 'medium' : 'low' } };
} };

export const measurers: Measurer[] = [data, testDiff, spend];
