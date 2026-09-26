#!/bin/sh
# A0.2 hook recorder. Saves the raw hook JSON an agent sends, makes NO decision, exits 0.
# Usage (wired up by setup.sh): record-hook.sh <agent> <event>
#   NOCAP_RECORD_SLEEP=90  → sleep before returning, to test whether long hooks are allowed (we need 300 s).

AGENT="$1"
EVENT="$2"
OUT_DIR="$(cd "$(dirname "$0")/../.." && pwd)/fixtures/hooks/$AGENT"
mkdir -p "$OUT_DIR"

PAYLOAD=$(cat)
TOOL=$(printf '%s' "$PAYLOAD" | grep -o '"tool_name" *: *"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')
MODE=$(printf '%s' "$PAYLOAD" | grep -o '"permission_mode" *: *"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')
STAMP=$(date +%Y%m%d-%H%M%S)-$$
BASE="$OUT_DIR/$EVENT${TOOL:+-$TOOL}-$STAMP"

printf '%s\n' "$PAYLOAD" > "$BASE.json"

# Metadata. Values only for a safe allowlist; for anything else we record variable NAMES only,
# because agent env vars can hold API keys.
{
  echo "agent=$AGENT event=$EVENT tool=${TOOL:-none} permission_mode=${MODE:-unknown}"
  echo "recorded_at=$(date -u +%FT%TZ)"
  for v in CLAUDECODE CLAUDE_CODE_ENTRYPOINT CODEX_SANDBOX CODEX_SANDBOX_NETWORK_DISABLED GEMINI_CLI TERM_PROGRAM SHELL; do
    eval "val=\${$v-<unset>}"
    echo "$v=$val"
  done
  echo "agent_env_names=$(env | cut -d= -f1 | grep -E 'CLAUDE|CODEX|GEMINI|OPENAI|AGENT' | tr '\n' ' ')"
  echo "PATH=$PATH"
} > "$BASE.meta"

if [ -n "$NOCAP_RECORD_SLEEP" ]; then
  sleep "$NOCAP_RECORD_SLEEP"
  echo "slept=${NOCAP_RECORD_SLEEP}s and was not killed" >> "$BASE.meta"
fi
exit 0
