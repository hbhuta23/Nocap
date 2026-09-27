// Writing text into a file is not running it: heredoc bodies copied by cat/tee don't make a command risky.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CheckRequest } from '@nocap/shared';
import { classify, executableText } from '../src/classifier';

const bash = (command: string): CheckRequest => ({
  session_id: 's', source: 'claude_hook', agent: 'claude-code', cwd: '/tmp/nowhere', tool: 'bash', command, intent: null,
});

const writesDemoDocs = [
  'set -e; cd /tmp/demo',
  "cat > DEMO.md <<'EOF'",
  'Step 3 runs: psql -c "DELETE FROM users WHERE last_login_at < now()"',
  'Step 5 re-embeds 34,012 articles with OpenAI embeddings (~$340).',
  'EOF',
  'cat <<-EOF > NOTES.md',
  '\tDROP TABLE payments',
  '\tEOF',
  'git init -q && git add -A',
].join('\n');

test('heredoc text written to a file is not classified', () => {
  assert.equal(classify(bash(writesDemoDocs)), 'safe');
  assert.ok(!executableText(writesDemoDocs).includes('DELETE'));
  assert.ok(executableText(writesDemoDocs).includes('git init'), 'commands after the heredoc are kept');
});

test('heredocs fed to a program are still checked', () => {
  assert.equal(classify(bash("psql postgres://x/shop <<'SQL'\nDELETE FROM users;\nSQL")), 'data');
  assert.equal(classify(bash("python3 - <<'EOF'\nimport openai\nEOF")), 'spend');
  assert.equal(classify(bash("cat <<'EOF' | sh\nrm -rf build\nEOF")), 'data');
});

test('a command after the heredoc is still checked', () => {
  assert.equal(classify(bash("cat > a.sql <<'EOF'\nselect 1;\nEOF\npsql -c \"DROP TABLE payments\"")), 'data');
});
