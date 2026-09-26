// Agent adapters: hook payload → CheckRequest, verdict → each agent's output format.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VerdictResponse } from '@nocap/shared';
import { toCheckRequest, toHookOutput } from '../src/adapters/claude';
import { toCodexCheckRequest } from '../src/adapters/codex';
import { toGeminiCheckRequest, toGeminiOutput } from '../src/adapters/gemini';
import { patchEdits, pickEdit } from '../src/adapters/edits';
import { checkedByHook, rememberHookCheck } from '../src/adapters/recent';
import { isFollowUp } from '../src/sessions';

const FIXTURES = join(__dirname, '../../../fixtures/hooks/claude-code');
const fixture = (prefix: string) => JSON.parse(readFileSync(join(FIXTURES, readdirSync(FIXTURES).find((f) => f.startsWith(prefix))!), 'utf8'));

const verdict = (v: Partial<VerdictResponse>): VerdictResponse => ({
  check_id: 'chk_1', verdict: 'allow', category: 'data', headline: 'h', facts: [],
  layers: { task_fit: { ok: true, why: '' }, intent_effect: { ok: true, why: '' } },
  reason_for_agent: 'Blocked by nocap: this deletes 48,213 users.', mode: 'full', latency_ms: 1, ...v,
});

// ---------- Claude Code (real payloads recorded in A0.2) ----------

test('claude: real Bash payload → bash check with the description as intent', () => {
  const p = fixture('PreToolUse-Bash-20260926-153834');
  const c = toCheckRequest(p)!;
  assert.equal(c.tool, 'bash');
  assert.equal(c.agent, 'claude-code');
  assert.match(c.command, /rm src\/scratch\.txt/);
  assert.equal(c.intent, 'Inspect then delete src/scratch.txt');
  assert.equal(c.session_id, p.session_id);
});

test('claude: real Edit payload → edit check with old/new text', () => {
  const c = toCheckRequest(fixture('PreToolUse-Edit'))!;
  assert.equal(c.tool, 'edit');
  assert.match(c.edit!.file, /src\/cart\.ts$/);
  assert.match(c.edit!.new, /0\.85/);
});

test('claude: Write compares against the current file, MultiEdit applies every edit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nocap-'));
  writeFileSync(join(dir, 'a.test.ts'), 'expect(f(1)).toBe(2);\nexpect(f(2)).toBe(4);\n');
  const w = toCheckRequest({ session_id: 's', cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(dir, 'a.test.ts'), content: 'x' } })!;
  assert.match(w.edit!.old, /toBe\(4\)/);
  const m = toCheckRequest({
    session_id: 's', cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'MultiEdit',
    tool_input: { file_path: join(dir, 'a.test.ts'), edits: [{ old_string: 'toBe(2)', new_string: 'toBe(3)' }, { old_string: 'toBe(4)', new_string: 'toBe(5)' }] },
  })!;
  assert.equal(m.edit!.new, 'expect(f(1)).toBe(3);\nexpect(f(2)).toBe(5);\n');
});

test('claude: unguarded tools get no decision', () => {
  assert.equal(toCheckRequest({ session_id: 's', cwd: '/', hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} }), null);
});

test('claude/codex output: plain allow = no decision; allow only after the developer confirmed; block = deny', () => {
  assert.deepEqual(toHookOutput(verdict({ verdict: 'allow' })), {});
  assert.equal((toHookOutput(verdict({ verdict: 'allow' }), true) as any).hookSpecificOutput.permissionDecision, 'allow');
  const denied = toHookOutput(verdict({ verdict: 'block' })) as any;
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /48,213/);
});

// ---------- Codex (doc-shaped; verify against real payloads) ----------

test('codex: Bash → bash check', () => {
  const c = toCodexCheckRequest({ session_id: 's', cwd: '/w', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf src' } })!;
  assert.equal(c.agent, 'codex');
  assert.equal(c.source, 'codex_hook');
  assert.equal(c.command, 'rm -rf src');
});

test('codex: apply_patch touching code and a test → checks the test file', () => {
  const patch = [
    '*** Begin Patch',
    '*** Update File: src/cart.ts',
    '@@',
    '-  return total * 0.9;',
    '+  return total * 0.85;',
    '*** Update File: src/cart.test.ts',
    '@@',
    '-  expect(applyDiscount(100)).toBe(85);',
    '+  expect(applyDiscount(100)).toBe(90);',
    '*** End Patch',
  ].join('\n');
  const c = toCodexCheckRequest({ session_id: 's', cwd: '/w', hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: patch } })!;
  assert.equal(c.tool, 'edit');
  assert.equal(c.edit!.file, 'src/cart.test.ts');
  assert.match(c.edit!.old, /toBe\(85\)/);
  assert.match(c.edit!.new, /toBe\(90\)/);
  assert.match(c.command, /src\/cart\.ts src\/cart\.test\.ts/);
});

test('patch parser: add and delete files', () => {
  const edits = patchEdits('/nonexistent', '*** Begin Patch\n*** Add File: new.ts\n+export const x = 1;\n*** Delete File: old.ts\n*** End Patch');
  assert.deepEqual(edits.map((e) => [e.file, e.old, e.new]), [['new.ts', '', 'export const x = 1;'], ['old.ts', '', '']]);
  assert.equal(pickEdit(edits)!.file, 'new.ts');
});

// ---------- Gemini CLI (doc-shaped; verify against real payloads) ----------

test('gemini: run_shell_command, write_file and replace map to checks', () => {
  const base = { session_id: 's', cwd: '/w', hook_event_name: 'BeforeTool' };
  const sh = toGeminiCheckRequest({ ...base, tool_name: 'run_shell_command', tool_input: { command: 'rm -rf src', description: 'clean' } })!;
  assert.deepEqual([sh.agent, sh.source, sh.tool, sh.command, sh.intent], ['gemini-cli', 'gemini_hook', 'bash', 'rm -rf src', 'clean']);
  assert.equal(toGeminiCheckRequest({ ...base, tool_name: 'write_file', tool_input: { file_path: 'a.ts', content: 'x' } })!.tool, 'write');
  const r = toGeminiCheckRequest({ ...base, tool_name: 'replace', tool_input: { file_path: 'a.test.ts', old_string: 'toBe(85)', new_string: 'toBe(90)' } })!;
  assert.deepEqual([r.tool, r.edit!.old, r.edit!.new], ['edit', 'toBe(85)', 'toBe(90)']);
  assert.equal(toGeminiCheckRequest({ ...base, tool_name: 'read_file', tool_input: {} }), null);
});

test('gemini output: {} to allow, {decision:"deny", reason} to block', () => {
  assert.deepEqual(toGeminiOutput(verdict({ verdict: 'allow' })), {});
  assert.equal((toGeminiOutput(verdict({ verdict: 'allow', human_confirmed: true })) as any).decision, 'allow');
  assert.deepEqual(toGeminiOutput(verdict({ verdict: 'block' })), { decision: 'deny', reason: 'Blocked by nocap: this deletes 48,213 users.' });
});

// ---------- No double checks: hook + shim ----------

test('a command a hook just let through is not re-checked by the shim', () => {
  rememberHookCheck('/w', `cd sub && psql -c "DELETE FROM users WHERE email LIKE '%@test.local'"`);
  // The shim re-quotes argv differently; it must still match.
  assert.equal(checkedByHook('/w', `psql -c 'DELETE FROM users WHERE email LIKE '"'"'%@test.local'"'"''`), true);
  assert.equal(checkedByHook('/w/sub', `psql -c "DELETE FROM users WHERE email LIKE '%@test.local'"`), true);
  assert.equal(checkedByHook('/w', 'rm -rf src'), false);
  assert.equal(checkedByHook('/other', `psql -c "DELETE FROM users WHERE email LIKE '%@test.local'"`), false);
});

// ---------- Task tracking (A2) ----------

test('follow-ups and refinements do not replace the task; new instructions do', () => {
  for (const p of ['yes', 'go ahead', 'ok do it', 'use the test.local ones', 'only the QA accounts please', 'actually skip the admins']) {
    assert.equal(isFollowUp(p), true, p);
  }
  for (const p of ['now fix the failing cart test please', 'clean up the test users', 'add embeddings for the new documents']) {
    assert.equal(isFollowUp(p), false, p);
  }
});
