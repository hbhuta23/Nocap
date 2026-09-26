#!/bin/sh
# A0.2 hook recorder. Saves the raw hook JSON an agent sends, makes NO decision, exits 0.
# Usage (wired up by setup.sh): record-hook.sh <agent> <event> [label]
#   label: where the hook was configured (e.g. "workspace" / "global"), added to the file name.
#   NOCAP_RECORD_SLEEP=90  → sleep before returning, to test whether long hooks are allowed (we need 300 s).

AGENT="$1"
EVENT="$2"
LABEL="$3"
PAYLOAD=$(cat)

# Antigravity's global hooks run for every project on the machine: only record the sandbox.
if [ "$AGENT" = "antigravity" ] && ! printf '%s' "$PAYLOAD" | grep -q 'nocap-sandbox'; then exit 0; fi

OUT_DIR="$(cd "$(dirname "$0")/../.." && pwd)/fixtures/hooks/$AGENT"
mkdir -p "$OUT_DIR"

# Tool name: Claude/Codex/Gemini send "tool_name"; Antigravity sends "toolCall": {"name": ...}.
TOOL=$(printf '%s' "$PAYLOAD" | grep -o '"tool_name" *: *"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')
[ -z "$TOOL" ] && TOOL=$(printf '%s' "$PAYLOAD" | tr -d '\n' | grep -o '"toolCall" *: *{ *"name" *: *"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')
MODE=$(printf '%s' "$PAYLOAD" | grep -o '"permission_mode" *: *"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')
STAMP=$(date +%Y%m%d-%H%M%S)-$$
BASE="$OUT_DIR/$EVENT${TOOL:+-$TOOL}${LABEL:+-$LABEL}-$STAMP"

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
