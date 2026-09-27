# Changelog

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
