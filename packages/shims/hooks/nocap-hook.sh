#!/bin/sh
# Nocap agent hook (A1, A2). Owner: Role A.
# Installed by the extension into each agent's hook config:
#   Claude Code  .claude/settings.local.json   nocap-hook.sh claude pre-tool-use | user-prompt-submit
#   Codex CLI    .codex/hooks.json             nocap-hook.sh codex  pre-tool-use | user-prompt-submit
#   Gemini CLI   .gemini/settings.json         nocap-hook.sh gemini before-tool  | before-agent
#   Antigravity  .agents/hooks.json            nocap-hook.sh antigravity pre-tool-use | pre-invocation
#   VS Code chat .github/hooks/nocap.json      nocap-hook.sh vscode pre-tool-use | user-prompt-submit
#   Cursor       .cursor/hooks.json            nocap-hook.sh cursor before-shell | pre-tool-use | before-submit-prompt
# (Old form `nocap-hook.sh <event>` still means Claude Code.)
# Forwards the raw hook JSON to the daemon and prints the daemon's reply in the agent's own format.

if [ $# -ge 2 ]; then AGENT="$1"; EVENT="$2"; else AGENT="claude"; EVENT="$1"; fi
PORT="${NOCAP_PORT:-7777}"
PAYLOAD=$(cat)

RESP=$(printf '%s' "$PAYLOAD" | /usr/bin/curl -sS --fail --max-time 310 \
  -H 'content-type: application/json' --data-binary @- \
  "http://127.0.0.1:$PORT/v1/$AGENT/$EVENT" 2>/dev/null)

if [ $? -eq 0 ]; then
  printf '%s' "$RESP"
  exit 0
fi

# FR-G4: daemon offline. Safe actions pass, obviously risky ones are denied.
case "$EVENT" in pre-tool-use|before-tool|before-shell) ;; *) exit 0 ;; esac
if printf '%s' "$PAYLOAD" | grep -Eiq \
  'rm -[a-z]*[rf]|DELETE FROM|DROP (TABLE|DATABASE)|TRUNCATE|reset --hard|clean -[a-z]*f|push (-f|--force)|branch -D'; then
  REASON="Nocap is offline, so risky actions are blocked. Ask the developer to start nocap."
  if [ "$AGENT" = "cursor" ]; then
    printf '{"permission":"deny","user_message":"%s","agent_message":"%s"}' "$REASON" "$REASON"
  elif [ "$AGENT" = "gemini" ] || [ "$AGENT" = "antigravity" ]; then
    printf '{"decision":"deny","reason":"%s"}' "$REASON"
  else
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}' "$REASON"
  fi
fi
exit 0
