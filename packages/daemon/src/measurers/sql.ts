// SQL dry run (B6–B8, FR-D1..D4): run the agent's statement inside a transaction that ALWAYS rolls back,
// and measure what it would really do. Owner: Role B (built by Role A, 2026-09-26).
//
//   BEGIN; SET LOCAL statement_timeout = 3s; SET LOCAL lock_timeout = 1s
//   → run the statement, capturing affected rows into a temp table
//   → rows affected, FK cascades (pg_stat_xact_user_tables), sensitive rows (.nocap.yml), redacted sample
//   → ROLLBACK (in finally). Never COMMIT; multi-statement input and COMMIT/BEGIN are refused.
//
// Connects with the env var named by .nocap.yml database.url_env (default DATABASE_URL).
// Known limits (BRD §4): triggers that call outside services still fire; dry runs can briefly take locks,
// so real deployments should point this at a replica.

import { Client } from 'pg';
import { parse } from 'shell-quote';
import type { Ctx, Fact, Measurement, Measurer, NocapConfig } from '@nocap/shared';
import { DESTRUCTIVE_SQL } from '../classifier';

type Kind = 'delete' | 'update' | 'drop' | 'truncate' | 'alter_drop';

const TARGET = /^\s*(?:(delete)\s+from|(update)|(drop)\s+table(?:\s+if\s+exists)?|(truncate)(?:\s+table)?|(alter)\s+table)\s+((?:"[^"]+"|[\w]+)(?:\.(?:"[^"]+"|[\w]+))?)/i;

export const sqlMeasurer: Measurer = {
  category: 'data',
  matches: (req) => req.tool === 'bash' && /\bpsql\b/.test(req.command) && DESTRUCTIVE_SQL.test(req.command),
  measure: async (req, ctx) => dryRun(extractSql(req.command), ctx),
};

/** The SQL in `psql ... -c "<sql>"` / `--command=<sql>`, else the destructive statement found in the text. */
export function extractSql(command: string): string {
  const tokens = parse(command, (key) => `$${key}`).map((t) => (typeof t === 'string' ? t : ''));
  for (let i = 0; i < tokens.length; i++) {
    if ((tokens[i] === '-c' || tokens[i] === '--command') && tokens[i + 1]) return tokens[i + 1];
    if (tokens[i].startsWith('--command=')) return tokens[i].slice('--command='.length);
    if (/^-c./.test(tokens[i])) return tokens[i].slice(2);
  }
  const m = command.match(DESTRUCTIVE_SQL);
  return m ? command.slice(m.index).replace(/["']\s*$/, '') : command;
}

export async function dryRun(sqlInput: string, ctx: Ctx): Promise<Measurement> {
  const sql = sqlInput.trim().replace(/;\s*$/, '');
  const operation = sql;
  const fail = (why: string): Measurement => ({
    facts: [{ label: 'Dry run', value: `not run: ${why}`, severity: 'medium' }],
    judgeContext: { operation, dry_run: `not run: ${why}` },
  });

  if (sql.includes(';')) return fail('multiple statements');
  if (/\b(commit|rollback|begin|start\s+transaction)\b/i.test(sql)) return fail('transaction control statements are never dry-run');
  const target = sql.match(TARGET);
  if (!target) return fail('could not find the target table');
  const kind = (target[1] ?? target[2] ?? target[3] ?? target[4] ?? (target[5] ? 'alter_drop' : '')).toLowerCase() as Kind;
  const table = target[6];

  const config: NocapConfig = ctx.config;
  const url = process.env[config.database?.url_env ?? 'DATABASE_URL'];
  if (!url) return fail(`no ${config.database?.url_env ?? 'DATABASE_URL'} set`);

  const started = Date.now();
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
  } catch (err) {
    return fail(`database unreachable (${err instanceof Error ? err.message : String(err)})`);
  }

  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '3s'");
    await client.query("SET LOCAL lock_timeout = '1s'");
    const before = await tableActivity(client);
    const rules = (config.database?.sensitive_rows ?? []).filter((r) => sameTable(r.table, table));

    let rows = 0;
    let sample: Record<string, unknown>[] = [];
    let emailDomains: Record<string, number> | undefined;
    const sensitiveHit: Record<string, number> = {};

    if ((kind === 'delete' || kind === 'update') && !/\breturning\b/i.test(sql)) {
      // Capture exactly the affected rows, so they can be counted, sampled and matched against rules.
      await client.query(`CREATE TEMP TABLE nocap_affected (LIKE ${table}) ON COMMIT DROP`);
      await client.query(`WITH nocap_a AS (${sql} RETURNING *) INSERT INTO nocap_affected SELECT * FROM nocap_a`);
      rows = Number((await client.query('SELECT count(*) AS n FROM nocap_affected')).rows[0].n);
      sample = (await client.query('SELECT * FROM nocap_affected LIMIT 10')).rows;
      if (sample[0] && 'email' in sample[0]) {
        const d = await client.query("SELECT split_part(email, '@', 2) AS domain, count(*) AS n FROM nocap_affected GROUP BY 1 ORDER BY 2 DESC LIMIT 6");
        emailDomains = Object.fromEntries(d.rows.map((r) => [r.domain, Number(r.n)]));
      }
      for (const r of rules) sensitiveHit[`${r.table}: ${r.where}`] = Number((await client.query(`SELECT count(*) AS n FROM nocap_affected WHERE ${r.where}`)).rows[0].n);
    } else {
      // DROP / TRUNCATE / ALTER ... DROP: every row of the table is affected.
      rows = Number((await client.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
      for (const r of rules) sensitiveHit[`${r.table}: ${r.where}`] = Number((await client.query(`SELECT count(*) AS n FROM ${table} WHERE ${r.where}`)).rows[0].n);
      const res = await client.query(sql);
      if (kind === 'delete' || kind === 'update') rows = res.rowCount ?? rows;
    }

    // FR-D2: rows changed in OTHER tables inside this transaction = foreign-key cascades the agent never mentioned.
    const after = await tableActivity(client);
    const cascades: Record<string, number> = {};
    for (const [t, n] of Object.entries(after)) {
      const delta = n - (before[t] ?? 0);
      if (delta > 0 && !sameTable(t, table)) cascades[t] = delta;
    }

    const protectedHit = (config.database?.protected_tables ?? []).filter((p) => sameTable(p, table) || Object.keys(cascades).some((c) => sameTable(p, c)));
    const sensitiveTotal = Object.values(sensitiveHit).reduce((a, b) => a + b, 0);
    const verb = kind === 'update' ? 'Rows updated' : kind === 'drop' ? 'Rows dropped' : 'Rows deleted';

    const facts: Fact[] = [
      { label: verb, value: rows.toLocaleString('en-US'), severity: rows > 1000 || sensitiveTotal > 0 ? 'high' : rows > 100 ? 'medium' : 'low' },
      ...Object.entries(sensitiveHit)
        .filter(([, n]) => n > 0)
        .map(([rule, n]): Fact => ({ label: `Sensitive rows (${rule})`, value: n.toLocaleString('en-US'), severity: 'high' })),
      ...(Object.keys(cascades).length
        ? [{ label: 'Cascaded tables', value: Object.entries(cascades).map(([t, n]) => `${t} (${n.toLocaleString('en-US')})`).join(', '), severity: 'medium' as const }]
        : []),
      ...(protectedHit.length ? [{ label: 'Protected tables hit', value: protectedHit.join(', '), severity: 'high' as const }] : []),
    ];

    return {
      facts,
      judgeContext: {
        operation,
        dry_run: 'ran in a transaction and rolled back',
        rows_affected: rows,
        rows_by_table: cascades,
        sensitive_rows_hit: sensitiveHit,
        protected_tables_hit: protectedHit,
        ...(emailDomains ? { email_domains_of_affected_rows: emailDomains } : {}),
        sample_rows: sample.map(withEmailDomain),
        dry_run_ms: Date.now() - started,
      },
      hardBlock: undefined,
    };
  } catch (err) {
    return fail(`the statement failed in the dry run (${err instanceof Error ? err.message : String(err)})`);
  } finally {
    // FR-D1: never commit. Rollback even if anything above threw.
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

/** n_tup_ins + n_tup_upd + n_tup_del per table, for THIS transaction only (temp tables excluded). */
async function tableActivity(client: Client): Promise<Record<string, number>> {
  const res = await client.query(
    "SELECT relname, n_tup_ins + n_tup_upd + n_tup_del AS n FROM pg_stat_xact_user_tables WHERE schemaname NOT LIKE 'pg_temp%'",
  );
  return Object.fromEntries(res.rows.map((r) => [r.relname, Number(r.n)]));
}

function sameTable(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/"/g, '').toLowerCase().split('.').pop();
  return norm(a) === norm(b);
}

/** Keep the email's domain (test.local vs gmail.com is what tells test data from real data); the judge
 *  strips the email itself via redact_columns (FR-G7). */
function withEmailDomain(row: Record<string, unknown>): Record<string, unknown> {
  return typeof row.email === 'string' ? { email_domain: row.email.split('@')[1] ?? '', ...row } : row;
}
