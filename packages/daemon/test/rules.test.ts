// Team rules: keyword routing (keeps safe actions off the AI path) and .nocap.yml loading.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ruleKeywords, rulesMentioned } from '../src/rules';
import { loadConfig } from '../src/config';
import { tamperTarget } from '../src/guard';

test('rule keywords keep the distinctive words, singularised', () => {
  assert.deepEqual(ruleKeywords('Never touch the payments table'), ['payment']);
  assert.deepEqual(ruleKeywords('Never edit files in db/migrations'), ['db/migration']);
  assert.deepEqual(ruleKeywords('Never force-push to main'), ['force-push', 'main']);
  assert.deepEqual(ruleKeywords("Don't change a test to make it pass; fix the code instead"), []);
});

test('a safe action reaches the judge only when it mentions what a rule is about', () => {
  const rules = ['Never touch the payments table', 'Never edit files in db/migrations'];
  assert.deepEqual(rulesMentioned(rules, { command: 'psql -c "UPDATE payments SET status = 1"' }), ['Never touch the payments table']);
  assert.deepEqual(rulesMentioned(rules, { command: 'write db/migrations/004.sql', edit: { file: 'db/migrations/004.sql', new: 'x' } }), ['Never edit files in db/migrations']);
  assert.deepEqual(rulesMentioned(rules, { command: 'ls -la' }), []);
  assert.deepEqual(rulesMentioned(rules, { command: 'npm test' }), []);
  assert.deepEqual(rulesMentioned([], { command: 'psql -c "UPDATE payments"' }), []);
});

test('.nocap.yml: rules and sensitive_rows load (the old parser dropped lists), found from a subfolder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nocap-'));
  writeFileSync(
    join(dir, '.nocap.yml'),
    [
      '# team config',
      'version: 1',
      'database:',
      '  sensitive_rows:',
      '    - table: users',
      `      where: "role = 'admin'"`,
      'rules:',
      '  - Never touch the payments table',
      '  - "Ask before anything that costs more than $2"',
      '  - ""',
    ].join('\n'),
  );
  mkdirSync(join(dir, 'src'));
  const config = loadConfig(join(dir, 'src'));
  assert.deepEqual(config.rules, ['Never touch the payments table', 'Ask before anything that costs more than $2']);
  assert.deepEqual(config.database?.sensitive_rows, [{ table: 'users', where: "role = 'admin'" }]);
  assert.equal(config.budget.per_command_usd, 5, 'defaults still merged');
});

test('.nocap.yml: missing or broken file falls back to defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nocap-'));
  assert.deepEqual(loadConfig(dir).rules, []);
  writeFileSync(join(dir, '.nocap.yml'), 'rules: [unclosed');
  assert.equal(loadConfig(dir).human_check, 'risky');
});

// ---------- Tamper guard: agents can't change nocap's own setup ----------

test("tamper guard: deleting or writing nocap's files is caught; reading and unrelated commands are not", () => {
  const bash = (command: string) => ({ session_id: 's', source: 'shim' as const, agent: 'unknown' as const, cwd: '/w', tool: 'bash' as const, command, intent: null });
  // seen live: an agent deleting the folder that holds the VS Code hook file
  assert.equal(tamperTarget(bash('rm -rf .github')), '.github');
  assert.equal(tamperTarget(bash('rm -rf ./.github/hooks/')), '.github/hooks');
  assert.equal(tamperTarget(bash('rm /w/.nocap.yml')), '.nocap.yml');
  assert.equal(tamperTarget(bash('mv .claude/settings.local.json /tmp/x')), '.claude/settings.local.json');
  assert.equal(tamperTarget(bash("sed -i '' 's/rules//' .nocap.yml")), '.nocap.yml');
  assert.equal(tamperTarget(bash('echo "{}" > .agents/hooks.json')), '.agents/hooks.json');
  assert.equal(tamperTarget(bash('ls && rm -rf .cursor')), '.cursor');
  const edit = { ...bash('edit .nocap.yml'), tool: 'edit' as const, edit: { file: '/w/.nocap.yml', old: 'a', new: 'b' } };
  assert.equal(tamperTarget(edit), '.nocap.yml');
  for (const ok of ['cat .nocap.yml', 'tail -n 20 .nocap.audit.jsonl', 'rm -rf src', 'rm -rf .github-old', 'rm -rf node_modules', 'git status', 'rm -rf .']) {
    assert.equal(tamperTarget(bash(ok)), null, ok);
  }
});
