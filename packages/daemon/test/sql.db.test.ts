// SQL dry run against the real demo database (`npm run db:up`). Skipped when it isn't running.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import type { Ctx, NocapConfig } from '@nocap/shared';
import { defaultConfig } from '../src/config';
import { dryRun, extractSql } from '../src/measurers/sql';

const URL = process.env.NOCAP_TEST_DATABASE_URL ?? 'postgres://nocap:nocap@localhost:5433/shop';
process.env.NOCAP_TEST_DB = URL;

const config: NocapConfig = {
  ...defaultConfig,
  database: { url_env: 'NOCAP_TEST_DB', protected_tables: ['payments'], sensitive_rows: [{ table: 'users', where: "role = 'admin'" }], redact_columns: ['email', 'name', 'password_hash'] },
};
const ctx: Ctx = { config, task: null, workspaceRoot: '/tmp' };

async function dbUp(): Promise<boolean> {
  const c = new Client({ connectionString: URL, connectionTimeoutMillis: 1000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}

async function count(sql: string): Promise<number> {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return Number((await c.query(sql)).rows[0].n);
  } finally {
    await c.end();
  }
}

/** Skips the test (and returns true) when the demo database isn't running. */
async function noDb(t: { skip: (msg: string) => void }): Promise<boolean> {
  if (await dbUp()) return false;
  t.skip('demo database not running (npm run db:up)');
  return true;
}

test('extractSql pulls the statement out of psql commands', () => {
  assert.equal(extractSql(`psql $DATABASE_URL -c "DELETE FROM users WHERE id = 1"`), 'DELETE FROM users WHERE id = 1');
  assert.equal(extractSql(`psql -d shop --command="UPDATE users SET role = 'x'"`), "UPDATE users SET role = 'x'");
  assert.equal(extractSql(`cd app && psql -c 'DROP TABLE sessions'`), 'DROP TABLE sessions');
});

test('demo: the broad delete measures 48,213 rows, 3 admins, cascades into orders and sessions', async (t) => {
  if (await noDb(t)) return;
  const m = await dryRun("DELETE FROM users WHERE last_login_at < now() - interval '90 days'", ctx);
  const j = m.judgeContext as any;
  assert.equal(j.rows_affected, 48213);
  assert.equal(j.sensitive_rows_hit["users: role = 'admin'"], 3);
  assert.deepEqual(j.rows_by_table, { orders: 1204, sessions: 5310 });
  assert.equal(j.email_domains_of_affected_rows['test.local'], undefined, 'no test accounts among them');
  assert.equal(m.facts[0].value, '48,213');
  // FR-G7 is the judge's job, but the domain must survive for it to tell test data from real data.
  assert.ok(j.sample_rows[0].email_domain);
});

test('demo: the narrow delete measures exactly the 178 test users, nothing else', async (t) => {
  if (await noDb(t)) return;
  const j = (await dryRun("DELETE FROM users WHERE email LIKE '%@test.local'", ctx)).judgeContext as any;
  assert.equal(j.rows_affected, 178);
  assert.deepEqual(j.rows_by_table, {});
  assert.equal(j.sensitive_rows_hit["users: role = 'admin'"], 0);
  assert.deepEqual(j.email_domains_of_affected_rows, { 'test.local': 178 });
});

test('B7: 100 dry-run deletes leave the database unchanged', async (t) => {
  if (await noDb(t)) return;
  const before = await count('SELECT (SELECT count(*) FROM users) + (SELECT count(*) FROM orders) + (SELECT count(*) FROM sessions) AS n');
  for (let i = 0; i < 100; i++) {
    const j = (await dryRun("DELETE FROM users WHERE last_login_at < now() - interval '90 days'", ctx)).judgeContext as any;
    assert.equal(j.rows_affected, 48213, `run ${i}: the dry run must actually execute (${j.dry_run})`);
  }
  const after = await count('SELECT (SELECT count(*) FROM users) + (SELECT count(*) FROM orders) + (SELECT count(*) FROM sessions) AS n');
  assert.equal(after, before);
});

test('DROP TABLE is measured and rolled back; the table still exists', async (t) => {
  if (await noDb(t)) return;
  const m = await dryRun('DROP TABLE sessions', ctx);
  assert.equal((m.judgeContext as any).rows_affected, 5310);
  assert.equal(await count('SELECT count(*) AS n FROM sessions'), 5310);
});

test('protected table hits are reported', async (t) => {
  if (await noDb(t)) return;
  const m = await dryRun("UPDATE payments SET status = 'processed' WHERE status = 'refund_pending'", ctx);
  assert.deepEqual((m.judgeContext as any).protected_tables_hit, ['payments']);
  assert.ok(m.facts.some((f) => f.label === 'Protected tables hit'));
});

test('refused: multiple statements, transaction control, unknown database', async () => {
  assert.match((await dryRun('DELETE FROM users; DELETE FROM orders', ctx)).facts[0].value, /multiple statements/);
  assert.match((await dryRun('COMMIT', ctx)).facts[0].value, /never dry-run|target table/);
  const bad = { ...ctx, config: { ...config, database: { ...config.database!, url_env: 'NOCAP_NO_SUCH_VAR' } } };
  assert.match((await dryRun('DELETE FROM users', bad)).facts[0].value, /no NOCAP_NO_SUCH_VAR set/);
});
