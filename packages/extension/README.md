<p align="center"><img src="https://raw.githubusercontent.com/hbhuta23/Polygraph/main/packages/extension/media/icon.png" width="96" alt="nocap logo"></p>

# nocap: Stop AI agents from capping

AI coding agents say one thing and do another. "Cleaning up test users" turns out to delete 48,213 rows.
"Fixing the failing test" turns out to change the expected value. nocap checks every risky action
**before it runs**, comparing three things:

1. **Task**: what you asked the agent to do
2. **Intent**: what the agent says this command is for
3. **Effect**: what the command would actually do, measured by a dry run

If they don't line up, nocap blocks the action and tells the agent why: **CAP DETECTED**.

## What it catches

- **Data destruction.** SQL runs inside a transaction that is always rolled back. nocap counts the rows it
  would touch, the tables it would cascade into, and any protected or sensitive rows.
- **Runaway spend.** Scripts that call LLM APIs get a cost estimate, which is checked against your budget.
- **Cheating the task.** Editing a test's expected value instead of fixing the code.
- **Team rules.** Plain-English rules your team commits in `.nocap.yml`, such as "Never touch the payments table".
- **The basics.** Secrets, production hosts, weakened security, and agents tampering with nocap's own files.

Safe commands pass in under 50 ms with no AI call.

## No rubber-stamping

To approve a risky action you have to type what you expect it to do. nocap compares your answer to the
measured effect. Typing "ok" doesn't count. If you expected 178 rows and the command deletes 48,213, you'll
see both numbers side by side before anything runs. Press Escape and the action is declined.

## Works with your agent

| Agent | How nocap sees it |
| --- | --- |
| Claude Code, Codex CLI, Gemini CLI, Cursor, VS Code chat | Native hooks: task, intent, commands and file edits |
| Aider, Copilot CLI, Antigravity, anything in a VS Code terminal | Terminal shims: every command, plus the pop-up |

Hooks are installed automatically for the agents found on your machine. You can turn this off with the
`nocap.autoProtect` setting and enable nocap per workspace instead.

## Getting started

1. Install the extension.
2. When asked, paste a Gemini API key ([get one here](https://aistudio.google.com/apikey)). It is kept in
   VS Code's secret storage and never written to disk.
3. Open a new terminal and start your agent. Restart Claude Code if it was already running, because it
   reads hooks at startup.

The shield icon in the editor title bar opens the nocap menu: team rules, the panel, and setting the task.

## Team rules and settings

Add a `.nocap.yml` to your repo:

```yaml
version: 1
database:
  url_env: DATABASE_URL
  protected_tables: [payments]
  redact_columns: [email, password_hash]   # never sent to the judge
human_check: risky
budget: { per_command_usd: 5, per_session_usd: 20 }
rules:
  - Never touch the payments table
  - Never edit files in db/migrations
```

## Privacy

- Dry runs never commit.
- Columns listed in `redact_columns` are removed before anything is sent to Gemini.
- Logs stay on your machine, in `~/.nocap/logs/`.
- Only localhost: the nocap service listens on `127.0.0.1:7777`.

## Known limits

- Running a binary by its full path (`/bin/rm`) bypasses the terminal shims. Native hooks still catch it.
- Database triggers that call outside services still fire during a dry run.
- nocap assumes agents are fallible, not malicious.
- Windows is not supported yet.

## License

MIT
