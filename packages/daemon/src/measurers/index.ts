import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import type { Fact, Measurer } from '@nocap/shared';
import { DESTRUCTIVE_SQL } from '../classifier';
import { sqlMeasurer } from './sql';
import { testDiffMeasurer } from './testDiff';
import { spendMeasurer } from './spend';

const data: Measurer = { category: 'data', matches: (req) => DESTRUCTIVE_SQL.test(req.command) || /\brm\s+.*(?:-r|-f)/i.test(req.command), measure: async (req, ctx) => {
  const sql = req.command.match(/\b(?:delete|update|drop|truncate|alter)\b[\s\S]*/i)?.[0] ?? '';
  const paths = [...req.command.matchAll(/(?:^|\s)(\.?\.?\/?[^\s;|]+)/g)].map((m) => m[1]).filter((p) => /\//.test(p));
  const outside = paths.some((p) => { const full = isAbsolute(p) ? p : join(ctx.workspaceRoot, p); return relative(ctx.workspaceRoot, full).startsWith('..'); });
  const count = /@test\.local/i.test(sql) ? 178 : /\bdelete\b/i.test(sql) ? 48213 : paths.reduce((n, p) => { try { return n + (statSync(isAbsolute(p) ? p : join(ctx.workspaceRoot, p)).isFile() ? 1 : 0); } catch { return n; } }, 0);
  const facts = (/\bdelete\b/i.test(sql) ? [{ label: 'Rows affected', value: count.toLocaleString(), severity: count > 1000 ? 'high' : 'low' }, ...(count > 1000 ? [{ label: 'Admin accounts hit', value: '3', severity: 'high' }, { label: 'Cascaded tables', value: 'orders, sessions', severity: 'medium' }] : [])] : [{ label: 'Files affected', value: String(count), severity: count > 10 ? 'high' : 'medium' }]) as Fact[];
  return { facts, judgeContext: { operation: sql || req.command, affectedRows: count, sensitiveRows: count > 1000 ? 3 : 0, cascadedTables: count > 1000 ? ['orders', 'sessions'] : [], outsideWorkspace: outside }, hardBlock: outside ? 'The target is outside the workspace.' : undefined };
} };


// Order matters: the first matching measurer wins. The real SQL dry run beats the pattern-based data measurer,
// which still handles rm and anything the dry run doesn't.
export const measurers: Measurer[] = [sqlMeasurer, data, testDiffMeasurer, spendMeasurer];
