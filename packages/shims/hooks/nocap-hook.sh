#!/bin/sh
# nocap Claude Code hook (A1, A2). Owner: Role A.
# Usage (installed by the extension into .claude/settings.local.json):
#   nocap-hook.sh pre-tool-use        (PreToolUse, matcher Bash|Edit|Write|MultiEdit, timeout 300)
#   nocap-hook.sh user-prompt-submit  (UserPromptSubmit)
# Forwards the raw hook JSON to the daemon and prints the daemon's hook output JSON.

EVENT="$1"
PORT="${NOCAP_PORT:-7777}"
PAYLOAD=$(cat)

RESP=$(printf '%s' "$PAYLOAD" | /usr/bin/curl -sS --fail --max-time 310 \
  -H 'content-type: application/json' --data-binary @- \
  "http://127.0.0.1:$PORT/v1/claude/$EVENT" 2>/dev/null)

if [ $? -eq 0 ]; then
  printf '%s' "$RESP"
  exit 0
fi

# FR-G4: daemon offline. Safe actions pass, obviously risky ones are denied.
if [ "$EVENT" = "pre-tool-use" ] && printf '%s' "$PAYLOAD" | grep -Eiq \
  'rm -[a-z]*[rf]|DELETE FROM|DROP (TABLE|DATABASE)|TRUNCATE|reset --hard|clean -[a-z]*f|push (-f|--force)|branch -D'; then
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"nocap is offline, so risky actions are blocked. Ask the developer to start nocap."}}'
fi
exit 0
