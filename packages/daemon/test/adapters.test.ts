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
import { latestPrompt, toAntigravityCheckRequest, toAntigravityOutput } from '../src/adapters/antigravity';
import { toVsCodeCheckRequest, toVsCodeOutput } from '../src/adapters/vscode';
import { toCursorOutput, toCursorShellCheck, toCursorToolCheck } from '../src/adapters/cursor';
import { patchEdits, pickEdit } from '../src/adapters/edits';
import { checkedByHook, rememberHookCheck } from '../src/adapters/recent';
import { isFollowUp } from '../src/sessions';

const FIXTURES = join(__dirname, '../../../fixtures/hooks/claude-code');
const fixture = (prefix: string) => JSON.parse(readFileSync(join(FIXTURES, readdirSync(FIXTURES).find((f) => f.startsWith(prefix))!), 'utf8'));

const verdict = (v: Partial<VerdictResponse>): VerdictResponse => ({
  check_id: 'chk_1', verdict: 'allow', category: 'data', headline: 'h', facts: [],
  layers: { task_fit: { ok: true, why: '' }, intent_effect: { ok: true, why: '' } },
  reason_for_agent: 'Blocked by Nocap: this deletes 48,213 users.', mode: 'full', latency_ms: 1, ...v,
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
  assert.deepEqual(toGeminiOutput(verdict({ verdict: 'block' })), { decision: 'deny', reason: 'Blocked by Nocap: this deletes 48,213 users.' });
});

// ---------- Antigravity (tool args verbatim from a real 1.2.11 transcript) ----------

const AG = join(__dirname, '../../../fixtures/hooks/antigravity');
const agFixture = (name: string) => JSON.parse(readFileSync(join(AG, name), 'utf8'));

test('antigravity: run_command → bash check, toolAction as intent, conversationId as session', () => {
  const p = agFixture('PreToolUse-run_command-constructed.json');
  const c = toAntigravityCheckRequest(p)!;
  assert.deepEqual([c.agent, c.source, c.tool, c.command, c.intent, c.cwd], ['antigravity', 'antigravity_hook', 'bash', 'ls -la src', 'Listing src directory', '/Users/hetanshbhuta/nocap-sandbox']);
  assert.equal(c.session_id, p.conversationId);
});

test('antigravity: replace_file_content on a test file → edit check (the test-cheat demo shape)', () => {
  const c = toAntigravityCheckRequest(agFixture('PreToolUse-replace_file_content-constructed.json'))!;
  assert.equal(c.tool, 'edit');
  assert.match(c.edit!.file, /src\/cart\.test\.ts$/);
  assert.match(c.edit!.new, /toBe\(80\)/);
});

test('antigravity: write_to_file → write check; unguarded tools get no decision', () => {
  const c = toAntigravityCheckRequest(agFixture('PreToolUse-write_to_file-constructed.json'))!;
  assert.deepEqual([c.tool, c.edit!.new], ['write', 'hello\n']);
  assert.equal(toAntigravityCheckRequest({ conversationId: 'c', toolCall: { name: 'view_file', args: {} } }), null);
});

test('antigravity: the latest prompt is read from the transcript (PreInvocation carries none)', () => {
  assert.equal(latestPrompt(join(AG, 'transcript-sample.jsonl')), 'create a file src/notes.md that says hello. This gets us a new-file payload.');
  assert.equal(latestPrompt('/does/not/exist.jsonl'), null);
});

test('antigravity output: {} to allow, {decision, reason} to block or ask', () => {
  assert.deepEqual(toAntigravityOutput(verdict({ verdict: 'allow' })), {});
  assert.deepEqual(toAntigravityOutput(verdict({ verdict: 'block' })), { decision: 'deny', reason: 'Blocked by Nocap: this deletes 48,213 users.' });
  assert.equal((toAntigravityOutput(verdict({ verdict: 'ask' })) as any).decision, 'ask');
  assert.equal((toAntigravityOutput(verdict({ verdict: 'allow', human_confirmed: true })) as any).decision, 'allow');
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

// ---------- VS Code chat / Copilot agent mode (doc-shaped; tool names undocumented) ----------

test('vscode: run_in_terminal (snake_case payload) → bash check with the explanation as intent', () => {
  const c = toVsCodeCheckRequest({ session_id: 's', cwd: '/w', tool_name: 'run_in_terminal', tool_input: { command: 'rm -rf src', explanation: 'Delete the src folder', isBackground: false } })!;
  assert.deepEqual([c.agent, c.source, c.tool, c.command, c.intent], ['vscode-chat', 'vscode_hook', 'bash', 'rm -rf src', 'Delete the src folder']);
});

test('vscode: camelCase GitHub variant with toolArgs as a JSON string', () => {
  const c = toVsCodeCheckRequest({ sessionId: 's2', cwd: '/w', toolName: 'run_in_terminal', toolArgs: JSON.stringify({ command: 'ls' }) })!;
  assert.deepEqual([c.session_id, c.command], ['s2', 'ls']);
});

test('vscode: edits by shape: replace_string_in_file, multi_replace, create_file, and unknown tools', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nocap-'));
  writeFileSync(join(dir, 'cart.test.ts'), 'expect(applyDiscount(100)).toBe(85);\n');
  const r = toVsCodeCheckRequest({ cwd: dir, tool_name: 'replace_string_in_file', tool_input: { filePath: join(dir, 'cart.test.ts'), oldString: 'toBe(85)', newString: 'toBe(90)' } })!;
  assert.deepEqual([r.tool, r.edit!.new], ['edit', 'expect(applyDiscount(100)).toBe(90);\n']);
  const m = toVsCodeCheckRequest({ cwd: dir, tool_name: 'multi_replace_string_in_file', tool_input: { filePath: 'cart.test.ts', replacements: [{ oldString: '85', newString: '80' }] } })!;
  assert.match(m.edit!.new, /toBe\(80\)/);
  const w = toVsCodeCheckRequest({ cwd: dir, tool_name: 'create_file', tool_input: { filePath: 'notes.md', content: 'hello' } })!;
  assert.deepEqual([w.tool, w.edit!.new], ['write', 'hello']);
  const unknown = toVsCodeCheckRequest({ cwd: dir, tool_name: 'some_future_edit_tool', tool_input: { filePath: 'a.ts', code: 'x' } })!;
  assert.equal(unknown.tool, 'write');
  const unknownShell = toVsCodeCheckRequest({ cwd: dir, tool_name: 'future_shell', tool_input: { command: 'rm -rf src' } })!;
  assert.equal(unknownShell.command, 'rm -rf src');
  assert.equal(toVsCodeCheckRequest({ cwd: dir, tool_name: 'read_file', tool_input: { filePath: 'a.ts', startLine: 1 } }), null);
});

test('vscode: delete_file becomes an rm check; output carries both decision shapes', () => {
  const d = toVsCodeCheckRequest({ cwd: '/w', tool_name: 'delete_file', tool_input: { filePath: 'src/cart.ts' } })!;
  assert.equal(d.command, 'rm /w/src/cart.ts');
  assert.deepEqual(toVsCodeOutput(verdict({ verdict: 'allow' })), {});
  const out = toVsCodeOutput(verdict({ verdict: 'block' })) as any;
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /48,213/);
});

// ---------- Cursor (doc-shaped; edit tool names undocumented) ----------

test('cursor: beforeShellExecution → bash check; conversation_id is the session', () => {
  const c = toCursorShellCheck({ conversation_id: 'conv1', workspace_roots: ['/w'], command: 'rm -rf src', cwd: '/w/app' })!;
  assert.deepEqual([c.agent, c.source, c.session_id, c.cwd, c.command], ['cursor', 'cursor_hook', 'conv1', '/w/app', 'rm -rf src']);
});

test('cursor: preToolUse maps edits by shape and skips shell tools (no double prompt)', () => {
  const e = toCursorToolCheck({ conversation_id: 'c', workspace_roots: ['/w'], tool_name: 'edit_file', tool_input: { file_path: 'src/cart.test.ts', old_string: 'toBe(85)', new_string: 'toBe(90)' } })!;
  assert.deepEqual([e.agent, e.tool, e.edit!.new], ['cursor', 'edit', 'toBe(90)']);
  assert.equal(toCursorToolCheck({ tool_name: 'Shell', tool_input: { command: 'rm -rf src' } }), null);
  assert.equal(toCursorToolCheck({ tool_name: 'run_terminal_cmd', tool_input: { command: 'ls' } }), null);
});

test('cursor output: {} to allow, {permission, user_message, agent_message} to block', () => {
  assert.deepEqual(toCursorOutput(verdict({ verdict: 'allow' })), {});
  const out = toCursorOutput(verdict({ verdict: 'block', headline: 'CAP DETECTED: 48,213 rows' })) as any;
  assert.deepEqual([out.permission, out.user_message], ['deny', 'Nocap: CAP DETECTED: 48,213 rows']);
  assert.match(out.agent_message, /48,213 users/);
});
