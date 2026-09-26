import type { Category, CheckRequest } from '@nocap/shared';

export function classify(req: CheckRequest): Category {
  const text = `${req.command} ${req.edit?.file ?? ''}`.toLowerCase();
  if (req.edit && /(^|\/)([^/]+\.(test|spec)\.[^/]+|test_[^/]+\.py$)|(^|\/)tests\//.test(req.edit.file)) return 'test_cheat';
  if (/\b(openai|anthropic|gemini|cohere|voyage|embedding|embeddings|chatcompletion)\b|api\.openai\.com|api\.anthropic\.com/.test(text)) return 'spend';
  if (/\b(delete|update|drop|truncate|alter)\b|\brm\s+.*(?:-r|-f)|git\s+(?:reset\s+--hard|clean\s+-f|checkout\s+--|push\s+.*--force|branch\s+-D)/.test(text)) return 'data';
  if (/\.env|private key|\b(sk-|akia|ghp_)/i.test(text)) return 'secrets';
  if (/terraform\s+(?:apply|destroy)|kubectl|prod|production/.test(text)) return 'prod';
  if (/chmod\s+777|curl .*\|\s*sh|insecure|verify_ssl\s*=\s*false/.test(text)) return 'security';
  return 'safe';
}