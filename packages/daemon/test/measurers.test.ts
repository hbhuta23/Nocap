// Test-diff facts (B11) and spend helpers (B10). The spend estimate itself needs Gemini + the demo DB,
// so it is covered by the live run; these cover the deterministic parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { CheckRequest, Ctx } from '@nocap/shared';
import { defaultConfig } from '../src/config';
import { isTestFile, noteEdit, testDiffFacts } from '../src/measurers/testDiff';
import { priceFor, runsLlmScript, scriptPath } from '../src/measurers/spend';

const SHOP = join(__dirname, '../../../demo/shop-app');
const ctx: Ctx = { config: defaultConfig, task: null, workspaceRoot: SHOP };
const edit = (file: string, old: string, next: string, session = 't'): CheckRequest => ({
  session_id: session, source: 'claude_hook', agent: 'claude-code', cwd: SHOP, tool: 'edit', command: `edit ${file}`, edit: { file, old, new: next }, intent: null,
});
const fact = (facts: { label: string; value: string }[], label: string) => facts.find((f) => f.label === label)?.value;

test('test files: default globs, nested paths, snapshots; not source files', () => {
  assert.equal(isTestFile('src/cart.test.ts', SHOP), true);
  assert.equal(isTestFile(join(SHOP, 'src/cart.test.ts'), SHOP), true);
  assert.equal(isTestFile('tests/login.spec.ts', SHOP), true);
  assert.equal(isTestFile('app/test_payments.py', SHOP), true);
  assert.equal(isTestFile('src/__snapshots__/Header.test.tsx.snap', SHOP), true);
  assert.equal(isTestFile('src/cart.ts', SHOP), false);
  assert.equal(isTestFile('src/testing-utils.ts', SHOP), false);
});

test('FR-T1: an expected value changed (the demo edit), with the code under test attached', async () => {
  const m = await testDiffFacts(edit('src/cart.test.ts', 'expect(applyDiscount(100)).toBe(85);', 'expect(applyDiscount(100)).toBe(90);'), ctx);
  const j = m.judgeContext as any;
  assert.deepEqual(j.expected_values_changed.map((c: any) => [c.from, c.to]), [['85', '90']]);
  assert.equal(fact(m.facts, 'Expected values changed'), '85 → 90');
  assert.match(j.code_under_test, /applyDiscount[\s\S]*total \* 0\.9/);
  assert.match(j.diff, /^-.*toBe\(85\)/m);
});

test('FR-T2/T3: skips added, tests deleted, fewer assertions; pytest style too', async () => {
  const skip = await testDiffFacts(edit('a.test.ts', "it('charges', () => { expect(x).toBe(1); });", "it.skip('charges', () => { expect(x).toBe(1); });"), ctx);
  assert.equal((skip.judgeContext as any).tests_skipped, 1);
  const del = await testDiffFacts(edit('a.test.ts', "test('a', () => { expect(a).toBe(1); });\ntest('b', () => { expect(b).toBe(2); });", "test('a', () => { expect(a).toBe(1); });"), ctx);
  assert.deepEqual([(del.judgeContext as any).tests_deleted, fact(del.facts, 'Assertions')], [1, '2 → 1']);
  const py = await testDiffFacts(edit('test_cart.py', 'def test_discount():\n    assert apply_discount(100) == 85\n', 'def test_discount():\n    assert apply_discount(100) == 90\n'), ctx);
  assert.deepEqual((py.judgeContext as any).expected_values_changed.map((c: any) => [c.from, c.to]), [['85', '90']]);
  const xfail = await testDiffFacts(edit('test_cart.py', 'def test_a():\n    assert f() == 1\n', '@pytest.mark.xfail\ndef test_a():\n    assert f() == 1\n'), ctx);
  assert.equal((xfail.judgeContext as any).tests_skipped, 1);
});

test('FR-T4: source edits made earlier in the session are reported (code files only)', async () => {
  noteEdit(edit('src/cart.ts', 'total * 0.9', 'total * 0.85', 'fixer'));
  noteEdit(edit('README.md', 'a', 'b', 'fixer'));
  const m = await testDiffFacts(edit('src/cart.test.ts', "test('x', () => {})", "test('x', () => { expect(1).toBe(1); })", 'fixer'), ctx);
  const changed = (m.judgeContext as any).source_files_changed_this_session as string[];
  assert.ok(changed.includes('src/cart.ts'));
  assert.ok(!changed.includes('README.md'));
});

test('FR-T5: snapshot overwritten, timeout raised', async () => {
  const snap = await testDiffFacts(edit('src/__snapshots__/H.test.tsx.snap', '<nav class="a">', '<nav class="b">'), ctx);
  assert.equal((snap.judgeContext as any).snapshot_overwritten, true);
  const t = await testDiffFacts(edit('a.test.ts', "test('slow', async () => {}, { timeout: 5000 })", "test('slow', async () => {}, { timeout: 60000 })"), ctx);
  assert.equal((t.judgeContext as any).timeout_raised, true);
});

test('spend: finds the script a command runs, and only flags scripts that call an LLM', () => {
  assert.equal(scriptPath('python scripts/backfill_embeddings.py', SHOP), join(SHOP, 'scripts/backfill_embeddings.py'));
  assert.equal(scriptPath('cd x && python3 -u scripts/a.py --limit 10', '/w'), '/w/scripts/a.py');
  assert.equal(scriptPath('npx tsx src/run.ts', '/w'), '/w/src/run.ts');
  assert.equal(scriptPath('npm test', '/w'), null);
  const bash = (command: string): CheckRequest => ({ session_id: 's', source: 'shim', agent: 'unknown', cwd: SHOP, tool: 'bash', command, intent: null });
  assert.equal(runsLlmScript(bash('python scripts/backfill_embeddings.py')), true);
  assert.equal(runsLlmScript(bash('node src/cart.ts')), false);
});

test('spend: prices by exact model, then closest key, then provider default', () => {
  assert.deepEqual([priceFor('gpt-5', 'openai').key, priceFor('gpt-5', 'openai').exact], ['gpt-5', true]);
  assert.equal(priceFor('text-embedding-3-large', 'openai').price.output, 0);
  assert.equal(priceFor('claude-sonnet-5', 'anthropic').key, 'claude-sonnet');
  assert.equal(priceFor('gemini-flash-lite-latest', 'gemini').key, 'gemini-flash-lite');
  assert.deepEqual([priceFor(null, 'anthropic').key, priceFor(null, 'anthropic').exact], ['claude-sonnet', false]);
});
