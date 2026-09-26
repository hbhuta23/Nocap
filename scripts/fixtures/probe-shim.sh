#!/bin/bash
# A0.2 shim probe. Logs how an agent's shell reached this shim, then runs the real binary.
# Answers: does each agent's shell keep our PATH, how are commands wrapped (bash -lc?), and which
# env var identifies the agent (so the shim can skip commands its native hook already checked).
# Wrappers in <sandbox>/.nocap-probe-bin call: exec probe-shim.sh <name> "$@"

NAME="$1"; shift
PROBE_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="${NOCAP_PROBE_BIN:?}"
LOG="$(cd "$PROBE_DIR/../.." && pwd)/fixtures/shims/probe.log"
mkdir -p "$(dirname "$LOG")"

REAL=""
IFS=: read -ra DIRS <<< "$PATH"
for d in "${DIRS[@]}"; do
  [ "$d" = "$BIN_DIR" ] && continue
  [ -x "$d/$NAME" ] && { REAL="$d/$NAME"; break; }
done

{
  echo "=== $(date -u +%FT%TZ) $NAME $*"
  echo "cwd=$PWD"
  echo "parent=$(ps -o command= -p $PPID 2>/dev/null)"
  echo "grandparent=$(ps -o command= -p "$(ps -o ppid= -p $PPID 2>/dev/null | tr -d ' ')" 2>/dev/null)"
  for v in CLAUDECODE CLAUDE_CODE_ENTRYPOINT CODEX_SANDBOX CODEX_SANDBOX_NETWORK_DISABLED GEMINI_CLI TERM_PROGRAM; do
    eval "echo \"$v=\${$v-<unset>}\""
  done
  echo "agent_env_names=$(env | cut -d= -f1 | grep -E 'CLAUDE|CODEX|GEMINI|OPENAI|AGENT' | tr '\n' ' ')"
  echo "PATH=$PATH"
} >> "$LOG"

[ -z "$REAL" ] && { echo "probe: $NAME not found" >&2; exit 127; }
exec "$REAL" "$@"
