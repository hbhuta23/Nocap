# CLAUDE.md

Guidance for Claude Code sessions in this repo. Read this first, then `docs/BRD.pdf` for detail
(requirement IDs like FR-D1, A12, B7 refer to it).

## What we're building

**nocap** (repo name: Polygraph) is a hackathon VS Code extension that guards AI coding agents
(Claude Code, Codex CLI, Gemini CLI, Aider, ...). Every risky action goes through a three-way check:

1. **Task**: what the developer asked the agent to do
2. **Intent**: what the agent says this command is for
3. **Effect**: what the command would actually do, measured by a dry run before it runs

If a layer contradicts the one above it, nocap blocks and tells the agent why ("CAP DETECTED").
It also blocks human rubber-stamping: approving a risky action requires typing what you expect it
to do, and the judge checks that against the measured effect (BRD §5.6).

Deep protections (the demo): data destruction (SQL dry run in a rolled-back transaction), runaway
spend (LLM-cost estimate vs budget), cheating the task (agent weakening tests instead of fixing code).
Basic pattern checks: secrets, production systems, weakened security.

**Never cut:** the data destruction check, the human intent pop-up, the CAP DETECTED screen.

## Agent support: every agent, not just Claude Code

Two interception layers, and the product must work with any CLI agent:

| Layer | Agents | What we get |
| --- | --- | --- |
| Native hooks (deep) | Claude Code (`PreToolUse`, `UserPromptSubmit`), Codex CLI (`PreToolUse`, `UserPromptSubmit`; Claude-compatible output), Gemini CLI (`BeforeTool`, `BeforeAgent`; output `{decision, reason}`, timeouts in **ms**) | task, intent, file edits, deny with reason |
| Shims (universal) | anything that runs shell commands in a VS Code terminal (Aider, Copilot CLI, ...) | commands only; intent via the `NOCAP_INTENT` retry protocol; task via panel |

Rules: never write Claude-only logic in shared code paths. Each agent gets its own adapter in
`packages/daemon/src/adapters/` (`claude.ts`, `codex.ts`, `gemini.ts`) that maps its hook JSON to
`CheckRequest` and the verdict back to its output format; `edits.ts` turns edit tools (and Codex
`apply_patch`) into old/new file text. Routes: `/v1/claude/*`, `/v1/codex/*`, `/v1/gemini/*`; the hook
script is `nocap-hook.sh <agent> <event>`. The installer writes Codex/Gemini hooks only when that CLI
is on the machine. **Claude Code is verified against real payloads; Codex and Gemini are built from
their docs and still need real payloads recorded into `fixtures/hooks/<agent>/` (scripts/fixtures/setup.sh).**

No double checks: an agent's shell commands hit its hook AND the shims. Shims skip when `CLAUDECODE`
is set, and for any agent the daemon remembers commands a hook let through for 60 s
(`adapters/recent.ts`), so the shim answers `allow` without a second check or pop-up.

## Team and ownership

- **Role A — Hetansh**: AI connector + extension. Claude Code hooks, shims, the Gemini judge and
  prompts, extension shell (daemon lifecycle, PATH injection, hook installer, status bar, commands),
  the human intent pop-up, eval set.
- **Role B — teammate**: backend + panel. Daemon pipeline, fast classifier, config loader, measurers,
  policy engine, human-check flow, MongoDB audit log, side panel webview, demo seed data.
- **Role C — teammate (no code)**: design and pitch. Pop-up and panel mockups, all user-facing
  wording (the "strings" doc), brand, demo video, landing page, Devpost. Copy UI text from C's
  strings doc; don't invent it.

Stay inside your own folders (see README table). If you need a change in the other person's area,
leave a `TODO(A)` / `TODO(B)` or ask, don't rewrite it.

## Repo layout

```
packages/shared/      contracts (types.ts = BRD §6), constants, reflex-answer rules
packages/judge/       [A] GeminiJudge, prompts/{data,spend,testCheat}, redact, eval/
packages/daemon/      [B] server.ts, pipeline.ts, sessions.ts, humanCheck.ts, measurers/
  src/adapters/       [A] claude.ts (hook JSON ↔ CheckRequest/hook output), shim.ts
packages/shims/       [A] bin/_nocap_shim + per-binary wrappers, hooks/nocap-hook.sh
packages/extension/   [A] extension.ts, daemonManager, pathInjection, hookInstaller, human/
  src/panel/          [B] PanelProvider (side panel webview)
demo/                 [B] seed SQL (mounted into Postgres), shop-app, reset
fixtures/hooks/       [A] real hook payloads captured from Claude Code
.nocap.yml            rules file (BRD §6.6); we dogfood nocap on this repo
```

## Commands

```bash
npm install                 # npm workspaces (not pnpm)
npm run typecheck           # tsc across all packages; run before every commit
npm run dev:daemon          # daemon with tsx watch on :7777
npm run build               # esbuild: extension + daemon + shims → packages/extension/dist
npm run package             # build + .vsix
npm run eval                # judge eval: 30 cases + spend extractor, score and latency (needs GEMINI_API_KEY)
npm test                    # unit tests: adapters (real Claude fixtures), redaction, task tracking
npm run db:up / db:down     # Postgres 16 in Docker
scripts/fixtures/setup.sh   # A0.2: sandbox that records real hook payloads from all agents
```

Debug the extension: open `packages/extension` in VS Code, F5. If a daemon is already healthy on
:7777 (e.g. `npm run dev:daemon`), the extension uses it instead of spawning its own.

## Contracts (do not change casually)

`packages/shared/src/types.ts` is the contract between A and B. Changes need both people to agree;
say so in the commit message. Key shapes: `CheckRequest`, `VerdictResponse`, `StreamEvent`,
`Measurer`, `Judge`, `NocapConfig`.

Daemon API (localhost:7777):

| Route | Caller | Notes |
| --- | --- | --- |
| `POST /v1/check` | anything | `CheckRequest` → `VerdictResponse`; held open during a human check |
| `POST /v1/task` | panel, CLI | set the task for a session |
| `POST /v1/human-intent` | extension pop-up | human's expectation or typed confirm number |
| `GET /v1/health` | extension, shims | |
| `WS /v1/stream` | panel, extension | `check.started/finished`, `task.updated`, `human.needed/answered` |
| `POST /v1/claude/pre-tool-use` | `nocap-hook.sh` | raw Claude hook JSON in, Claude hook output JSON out |
| `POST /v1/claude/user-prompt-submit` | `nocap-hook.sh` | sets the task from the prompt |
| `POST /v1/shim` | `_nocap_shim` | url-encoded `bin,cwd,intent,session,arg×N`; text reply `verdict\nreason` |

The last three are adapter routes (Role A) added so hook/shim scripts stay dumb and all mapping is
testable TypeScript. Shims exit **86** on block/ask.

## Invariants (never break these)

- **Dry runs never commit.** `BEGIN` → statement (3 s statement timeout, 1 s lock timeout) → `ROLLBACK` in `finally`. Refuse `COMMIT` and multi-statement input.
- **Nothing sensitive reaches Gemini** (FR-G7). Everything goes through `judge/src/redact.ts`; redacted columns come from `.nocap.yml`.
- **The AI reads, math decides.** Row counts, file counts and dollar estimates are computed deterministically; the judge only compares them to task/intent. Hard rules in `.nocap.yml` beat the judge.
- **Safe commands < 50 ms, no AI call** (FR-G1). Deep checks < 5 s. Judge timeout 4 s → `mode: "rules_only"` (FR-G5).
- **Daemon down:** safe commands pass, risky ones are blocked with "nocap is offline" (FR-G4). Both the hook and the shim have an inline fallback regex for this.
- **Plain "allow" returns no decision to Claude Code**, so Claude's own permission prompt still applies. Only return `permissionDecision: "allow"` when the human already confirmed in nocap's pop-up (FR-H5).
- **Every `reason_for_agent` is written for the agent:** what was wrong (one number), why it doesn't match, what to do instead.
- **Audit logging never slows a verdict**; fall back to a local `.jsonl` if Atlas is unreachable.

## Gotchas we already know about

- Shims must skip their own folder when looking up the real binary (and use the real `curl`), or they recurse forever. `_nocap_shim` does this.
- Claude Code's Bash tool inherits the terminal PATH, so its commands also hit the shims. Shims skip checking when `CLAUDECODE` is set, since the PreToolUse hook already checked (confirmed in A0.2: `CLAUDECODE=1` in the Bash tool).
- A0.2 findings (Claude Code, `fixtures/hooks/claude-code/`): hooks fire in `auto` mode (now the default); every Bash call carries `tool_input.description` (free intent); `prompt_id` links each tool call to the `UserPromptSubmit` that caused it (use it for task tracking).
- Claude Code itself runs `git` ~100 times in the background (status line, change tracking) without `CLAUDECODE` set. The shim runs read-only git locally with no daemon call; keep that fast path.
- Agents notice shims and route around them: in A0.2 Claude inspected `.nocap-probe-bin/` and called `/opt/homebrew/bin/node` by full path. Native hooks saw every call anyway. Hooks are the primary layer; shims are the fallback.
- Hooks are installed into `.claude/settings.local.json` (gitignored), not `settings.json`, so teammates without nocap aren't blocked by "nocap is offline". Claude Code reads hooks at startup: restart it (or review `/hooks`) after installing.
- `environmentVariableCollection` only affects terminals opened after it's set; old terminals need relaunching.
- The daemon is spawned with VS Code's own Node (`process.execPath` + `ELECTRON_RUN_AS_NODE=1`), so it must stay pure JS (no native modules).
- Port 7777 is shared across VS Code windows; the first window's daemon serves all of them.
- Gemini model (decided from the A18 eval, 2026-09-26): **`gemini-flash-lite-latest`**: 30/30 on three runs, 0 false blocks, median ~1.1 s, max ~1.5 s (inside the 4 s judge timeout). `gemini-3.8-flash` scored the same but took 3–12 s; `gemini-3.5-flash-lite` let a snapshot overwrite through. `-latest` is an alias Google can move, so re-run `npm run eval` before the demo. `gemini-2.5-flash` is retired for new keys. 503 "high demand" is retried once; the key needs billing (free tier ran out after ~6 calls).
- The pop-up's rules (queue, Escape = decline, close stale ones) are documented at the top of `extension/src/human/intentPrompt.ts`; they came from bugs in the first live test.
- `judgeContext` must use explicit counts with clear names (`rows_matching_test_email_pattern: 178`), never bare ratios; the judge misread `1.0` as "1 row".
- `UserPromptSubmit` fires on every prompt, so follow-ups like "yes go ahead" would overwrite the task. Needs handling in `sessions.ts`.

## Status (update as things land)

- Role B v1 (merged 2026-09-26): pipeline, classifier, policy, config loader, human-check flow, local `.nocap.audit.jsonl`.
  **Measurers are placeholders:** row counts, cascades and spend are hard-coded by regex (e.g. `@test.local` → 178,
  else 48,213). The real Postgres dry run (B6–B8), spend math (B10), and MongoDB (B15) are still to do.
  The data measurer's `judgeContext` should follow the field list in `judge/src/prompts/data.ts`; the
  test-diff measurer should include the diff and `source_files_changed_this_session` (B11); the spend
  measurer should call `judge.extractSpend(script)` (FR-S1) and compute dollars itself.
- Role A (2026-09-26): judge + prompts for data, spend (incl. FR-S1 extractor), test-cheat and human answers;
  eval 30/30 + extractor 3/3; redaction of `.nocap.yml` redact_columns on every judge call (FR-G7, unit-tested);
  human answers judged by Gemini (`speaker: 'human'`) with Role B's keyword match as the rules-only fallback;
  explicit `allow` to the agent after the developer confirms (`human_confirmed`, FR-H5); task tracking keeps
  the real task across follow-ups (`sessions.addPrompt`, A2); Codex and Gemini adapters (docs-based).
- Verified end to end: Claude Code/Codex/Gemini hook → pipeline → Gemini judge → deny in each agent's format;
  pop-up flow with explicit allow; shim skips hook-checked commands (17 ms). Live-tested in VS Code with Claude Code.
- Still to do (A): record real Codex/Gemini payloads and fix their adapters; A19 live tuning (each demo 5×
  with a real agent); VS Code SecretStorage for the API key; the webview pop-up from Role C's design.

## Demo numbers (keep exact; BRD §5)

- Data: 48,391 users (178 `@test.local`, 3 admins). Broad `DELETE ... last_login_at < now() - interval '90 days'` → 48,213 rows, 3 admins, 2 cascaded tables (`orders`, `sessions`) → block. `WHERE email LIKE '%@test.local'` → 178 → allow.
- Spend: `scripts/backfill_embeddings.py` ≈ $340 vs $20 budget → block; with `WHERE embedding IS NULL` → < $1 → allow.
- Test cheat: task "fix the failing cart test"; agent edits expected value in `cart.test.ts` → block with "Fix `applyDiscount`" hint.
- Human: "ok" → refused; "delete the QA test accounts" → matches 178, mismatches 48,213 (type `48213` to override).

## Working conventions

- TypeScript everywhere except the hook/shim scripts (bash/sh). Match the existing style: small modules, short comments that cite BRD IDs (`// A10`, `// FR-H3`).
- Workspace packages export TS source directly (`main: src/index.ts`); esbuild bundles for the extension, `tsx` runs the daemon in dev.
- Branch per person, PR (or fast-forward) into `main`. Run `npm run typecheck` and `npm run build` before pushing. `main` must always typecheck.
- Never commit `node_modules/` (it's gitignored; don't `git add -f`). Never replace the root `package.json`: it's the npm workspace root. A package's dependencies go in that package's own `package.json` (`npm i <lib> -w packages/daemon`).
- When merging, if `packages/shared/src/types.ts` conflicts, keep the version the code compiles against and add new types on top. Never take "theirs" wholesale.
- Secrets live in `.env` (gitignored). Never commit keys, and never log request bodies that might contain them.
- Known limits we state openly: `/bin/rm` by full path skips shims (hooks still catch it for Claude Code); DB triggers calling outside services still fire during a dry run; we assume agents are fallible, not malicious.
