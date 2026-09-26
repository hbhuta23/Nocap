// A17 / FR-G7: nothing sensitive reaches Gemini.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../src/redact';
import { buildPrompt } from '../src/prompts';

const context = {
  operation: "DELETE FROM users WHERE last_login_at < now() - interval '90 days'",
  rows_affected: 48213,
  sample_rows: [
    { id: 1, email: 'maria.lopez@gmail.com', name: 'Maria Lopez', password_hash: '$2b$10$abc', role: 'admin', email_domain: 'gmail.com' },
    { id: 2, EMAIL: 'qa1@test.local', Phone: '+1 555 0100', role: 'user' },
  ],
  note: 'contact ops@company.com, key sk-abcdefghijklmnopqrstuvwxyz123456 and AKIAABCDEFGHIJKLMNOP',
};
const columns = ['email', 'name', 'password_hash', 'phone'];

test('redacted columns are dropped at any depth, case-insensitively', () => {
  const out = JSON.stringify(redact(context, columns));
  for (const leaked of ['maria.lopez@gmail.com', 'Maria Lopez', '$2b$10$abc', 'qa1@test.local', '+1 555 0100']) {
    assert.ok(!out.includes(leaked), `leaked ${leaked}`);
  }
  assert.ok(out.includes('"role":"admin"'), 'non-sensitive columns are kept');
  assert.ok(out.includes('"email_domain":"gmail.com"'), 'derived non-sensitive columns are kept');
});

test('emails and secret-looking strings in free text are masked', () => {
  const out = JSON.stringify(redact(context, columns));
  for (const leaked of ['ops@company.com', 'sk-abcdefghijklmnopqrstuvwxyz123456', 'AKIAABCDEFGHIJKLMNOP']) {
    assert.ok(!out.includes(leaked), `leaked ${leaked}`);
  }
});

test('the prompt sent to Gemini contains no email address', () => {
  const prompt = buildPrompt({
    task: 'clean up the test users',
    intent: 'remove QA users',
    speaker: 'agent',
    category: 'data',
    judgeContext: redact(context, columns),
  });
  assert.equal(prompt.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g), null);
});
