import { runsLlmScript } from './measurers/spend';
import type { Category, CheckRequest } from '@nocap/shared';

/**
 * SQL verbs only count when they look like a SQL statement. Bare words gave false positives:
 * `git update-index` (Claude Code runs it in the background every few seconds), `npm update`, `brew update`.
 */
export const DESTRUCTIVE_SQL = /\b(?:delete\s+from|update\s+[\w."]+\s+set|drop\s+(?:table|database|schema|view|index)|truncate\s+(?:table\s+)?[\w."]+|alter\s+table\s+[\w."]+\s+drop)\b/i;

/** BRD §5.4 FR-B2: terraform apply/destroy, kubectl on a prod context, deploy scripts. Not any word containing "prod". */
const PRODUCTION = /terraform\s+(?:apply|destroy)|kubectl\b.*--context[=\s]\S*prod|\b(?:npm|pnpm|yarn)\s+run\s+deploy\b|(?:^|[\s/])deploy\.sh\b/;

/** Commands that only copy a heredoc's text somewhere (a file, the screen). Anything else (psql, python, sh) runs it. */
const INERT_HEREDOC_READERS = /^(?:cat|tee)\b/;

/**
 * The command without heredoc text that is only being written out: `cat > DEMO.md <<'EOF' … EOF` writes a file
 * and runs nothing, so SQL or API names in its body can't make the command risky. A heredoc fed to a program
 * (`psql <<SQL`, `python3 - <<EOF`, `cat <<EOF | sh`) keeps its body. The tamper guard still sees the full command.
 */
export function executableText(command: string): string {
  const lines = command.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const m = /<<(-?)\s*(['"]?)([A-Za-z_][\w-]*)\2/.exec(line);
    if (!m) continue;
    const segment = line.slice(0, m.index).split(/;|&&|\|\||\||\(/).pop()!.trim();
    const rest = line.slice(m.index + m[0].length);
    if (!INERT_HEREDOC_READERS.test(segment) || rest.includes('|')) continue;
    // Skip the body, up to the terminator line (`<<-` allows leading tabs before it).
    const isEnd = (l: string) => (m[1] ? l.replace(/^\t+/, '') : l) === m[3];
    let j = i + 1;
    while (j < lines.length && !isEnd(lines[j])) j++;
    i = j;
  }
  return out.join('\n');
}

export function classify(req: CheckRequest): Category {
  const text = `${executableText(req.command)} ${req.edit?.file ?? ''}`.toLowerCase();
  if (req.edit && /(^|\/)([^/]+\.(test|spec)\.[^/]+|test_[^/]+\.py$)|(^|\/)tests\//.test(req.edit.file)) return 'test_cheat';
  // A script that calls an LLM API (checked by reading it; cached), even if the command itself doesn't say so.
  if (runsLlmScript(req)) return 'spend';
  if (/\b(openai|anthropic|gemini|cohere|voyage|embedding|embeddings|chatcompletion)\b|api\.openai\.com|api\.anthropic\.com/.test(text)) return 'spend';
  if (DESTRUCTIVE_SQL.test(text) || /\brm\s+.*(?:-r|-f)|git\s+(?:reset\s+--hard|clean\s+-f|checkout\s+--|push\s+.*--force|branch\s+-d)/.test(text)) return 'data';
  if (/\.env|private key|\b(sk-|akia|ghp_)/i.test(text)) return 'secrets';
  if (PRODUCTION.test(text)) return 'prod';
  if (/chmod\s+777|curl .*\|\s*sh|insecure|verify_ssl\s*=\s*false/.test(text)) return 'security';
  return 'safe';
}