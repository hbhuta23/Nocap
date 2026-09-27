# Nocap

**Other tools read the command. Nocap tests it first.**

Nocap is a VS Code extension that makes every AI coding agent prove what it's about to do before it does it.
Every risky action is checked three ways: the **task** (what the developer asked), the **intent** (what the agent
says the command is for), and the **effect** (what a dry run shows it would actually do). If they don't line up,
Nocap blocks it and tells the agent why. It also stops developers from rubber-stamping: to approve a risky action
you have to type what you expect it to do.

Full spec: [`docs/BRD.pdf`](docs/BRD.pdf). macOS and Linux only.

## Quick start (dev)

```bash
npm install
cp .env.example .env          # add GEMINI_API_KEY, MONGODB_URI
npm run db:up                 # Postgres 16 in Docker (demo DB)
npm run dev:daemon            # stub daemon on localhost:7777
npm run build                 # bundles extension + daemon + shims into packages/extension/dist
```

Then open `packages/extension` in VS Code and press F5, or `npm run package` and install the `.vsix`.

## Layout

| Path | What | Owner |
| --- | --- | --- |
| `packages/shared` | Contracts (BRD §6): types, constants, reflex-answer rules | both |
| `packages/judge` | Gemini judge, prompts, redaction, eval set | A |
| `packages/daemon` | Fastify server, pipeline, measurers, policy, human-check flow, audit log | B |
| `packages/daemon/src/adapters` | Claude Code hook + shim → `CheckRequest` mapping | A |
| `packages/shims` | Command shims (`rm`, `git`, `psql`, `python`) and the Claude Code hook script | A |
| `packages/extension` | VS Code extension: daemon lifecycle, PATH injection, hook installer, pop-up | A |
| `packages/extension/src/panel` | Side panel webview | B |
| `demo/` | Seed data, demo `shop-app` repo, reset script | B |
| `fixtures/hooks` | Real Claude Code hook payloads captured in A0.2 | A |
