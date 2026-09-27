# Changelog

## 0.1.4

- Each VS Code window shows only its own workspace: approvals, block alerts, panel history and stats
- A task typed in the panel applies only to agents in that workspace
- An agent working in a folder no window has open still gets its approval shown in every window

## 0.1.3

- The approval card can be dragged by its header (double-click to re-centre) and reopens where you left it
- Writing a file with a heredoc (`cat > notes.md <<EOF`) is no longer treated as running the text inside it
- VS Code closed: risky actions are blocked at once with a clear reason, instead of waiting 5 minutes
- Reopening VS Code shows approvals that are still waiting

## 0.1.2

- Any AI provider for the judge: Gemini, Anthropic, OpenAI, OpenRouter, Groq or xAI, recognised from the key
- Now spelled Nocap everywhere

## 0.1.1

- Icon: transparent rounded corners (no white edges)

## 0.1.0

First release.

- Three-way check (task, intent, effect) for risky agent actions
- SQL dry run in a rolled-back transaction, LLM spend estimate, weakened-test detection
- Team rules in `.nocap.yml`, enforced by the judge; breaking one needs an explicit override
- Approval pop-up: say what you expect before you approve; Escape declines
- Hooks for Claude Code, Codex CLI, Gemini CLI, Cursor and VS Code chat; terminal shims for everything else
- Side panel with live checks and history
