#!/bin/bash
# A0.2: create a throwaway sandbox project wired to record hooks from Claude Code, Codex CLI and
# Gemini CLI, plus a shim probe. Nothing is blocked; everything is only recorded.
# Usage: scripts/fixtures/setup.sh [sandbox-dir]   (default: ~/nocap-sandbox)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SANDBOX="${1:-$HOME/nocap-sandbox}"
REC="$REPO/scripts/fixtures/record-hook.sh"
PROBE="$REPO/scripts/fixtures/probe-shim.sh"

mkdir -p "$SANDBOX"/{.claude,.codex,.gemini,.nocap-probe-bin,src}
cd "$SANDBOX"
[ -d .git ] || git init -q

# A tiny project so agents have something to edit, delete and test.
cat > src/cart.ts <<'EOF'
export function applyDiscount(total: number): number {
  return total * 0.9; // bug: should be a 15% discount
}
EOF
cat > src/cart.test.ts <<'EOF'
import { applyDiscount } from './cart';
test('applies 15% discount', () => {
  expect(applyDiscount(100)).toBe(85);
});
EOF
printf 'scratch\n' > src/scratch.txt

# Claude Code: timeouts in seconds.
cat > .claude/settings.local.json <<EOF
{
  "hooks": {
    "PreToolUse": [{ "hooks": [{ "type": "command", "command": "\"$REC\" claude-code PreToolUse", "timeout": 300 }] }],
    "PermissionRequest": [{ "hooks": [{ "type": "command", "command": "\"$REC\" claude-code PermissionRequest", "timeout": 30 }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "\"$REC\" claude-code UserPromptSubmit", "timeout": 30 }] }]
  }
}
EOF

# Codex CLI: timeouts in seconds. Project hooks need a one-time trust review (/hooks in Codex).
cat > .codex/hooks.json <<EOF
{
  "hooks": {
    "PreToolUse": [{ "hooks": [{ "type": "command", "command": "\"$REC\" codex PreToolUse", "timeout": 300 }] }],
    "PermissionRequest": [{ "hooks": [{ "type": "command", "command": "\"$REC\" codex PermissionRequest", "timeout": 30 }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "\"$REC\" codex UserPromptSubmit", "timeout": 30 }] }]
  }
}
EOF

# Gemini CLI: timeouts in MILLISECONDS. No matcher = record every tool, so we learn real tool names.
cat > .gemini/settings.json <<EOF
{
  "hooks": {
    "BeforeTool": [{ "hooks": [{ "type": "command", "command": "\"$REC\" gemini-cli BeforeTool", "timeout": 300000 }] }],
    "BeforeAgent": [{ "hooks": [{ "type": "command", "command": "\"$REC\" gemini-cli BeforeAgent", "timeout": 30000 }] }]
  }
}
EOF

# Shim probe wrappers (same binaries nocap shims, plus a few to learn about).
for b in rm git psql python python3 node curl; do
  printf '#!/bin/bash\nexec "%s" %s "$@"\n' "$PROBE" "$b" > ".nocap-probe-bin/$b"
done
chmod +x .nocap-probe-bin/* "$REC" "$PROBE"

cat <<EOF

Sandbox ready: $SANDBOX
Recordings go to: $REPO/fixtures/hooks/<agent>/ and $REPO/fixtures/shims/probe.log

Run each agent from a terminal set up like a nocap-protected VS Code terminal:

  cd "$SANDBOX"
  export NOCAP_PROBE_BIN="$SANDBOX/.nocap-probe-bin"
  export PATH="\$NOCAP_PROBE_BIN:\$PATH"

  claude      # Claude Code
  codex       # Codex CLI   (npm i -g @openai/codex; approve the hooks via /hooks)
  gemini      # Gemini CLI  (npm i -g @google/gemini-cli)

In each agent, give these prompts (approve whatever it asks):
  1. "delete src/scratch.txt using rm in the shell"
  2. "fix the failing test in src/cart.test.ts"      (we want an Edit/Write/patch payload)
  3. "run git status"

Then repeat prompt 1 in auto-approve mode to prove hooks still fire:
  claude --permission-mode bypassPermissions   |   codex --yolo   |   gemini --yolo
And once with NOCAP_RECORD_SLEEP=90 set before launching, to prove long hooks aren't killed
(check the .meta file for "slept=90s").
EOF
