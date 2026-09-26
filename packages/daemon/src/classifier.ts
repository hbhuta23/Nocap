import { runsLlmScript } from './measurers/spend';
import type { Category, CheckRequest } from '@nocap/shared';

/**
 * SQL verbs only count when they look like a SQL statement. Bare words gave false positives:
 * `git update-index` (Claude Code runs it in the background every few seconds), `npm update`, `brew update`.
 */
export const DESTRUCTIVE_SQL = /\b(?:delete\s+from|update\s+[\w."]+\s+set|drop\s+(?:table|database|schema|view|index)|truncate\s+(?:table\s+)?[\w."]+|alter\s+table\s+[\w."]+\s+drop)\b/i;

/** BRD §5.4 FR-B2: terraform apply/destroy, kubectl on a prod context, deploy scripts. Not any word containing "prod". */
const PRODUCTION = /terraform\s+(?:apply|destroy)|kubectl\b.*--context[=\s]\S*prod|\b(?:npm|pnpm|yarn)\s+run\s+deploy\b|(?:^|[\s/])deploy\.sh\b/;

export function classify(req: CheckRequest): Category {
  const text = `${req.command} ${req.edit?.file ?? ''}`.toLowerCase();
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