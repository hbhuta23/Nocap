// Which AI provider an API key belongs to, from its prefix. The judge works with any of them; Gemini is the default.
// NOCAP_PROVIDER forces one (for keys with no recognisable prefix, or a local OpenAI-compatible server via NOCAP_BASE_URL).

export type ProviderId = 'gemini' | 'anthropic' | 'openai' | 'openrouter' | 'groq' | 'xai';

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  /** Fast, cheap model that fits the 4 s judge timeout (FR-G5). Override with NOCAP_MODEL. */
  defaultModel: string;
  /** OpenAI-compatible endpoint; unset for Gemini and Anthropic (their own SDKs). */
  baseURL?: string;
  keyUrl: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  gemini: { id: 'gemini', name: 'Gemini', defaultModel: 'gemini-flash-lite-latest', keyUrl: 'https://aistudio.google.com/apikey' },
  anthropic: { id: 'anthropic', name: 'Anthropic', defaultModel: 'claude-haiku-4-5', keyUrl: 'https://platform.claude.com/settings/keys' },
  openai: { id: 'openai', name: 'OpenAI', defaultModel: 'gpt-5.4-mini', baseURL: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys' },
  openrouter: { id: 'openrouter', name: 'OpenRouter', defaultModel: 'openai/gpt-4.1-mini', baseURL: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys' },
  groq: { id: 'groq', name: 'Groq', defaultModel: 'llama-3.3-70b-versatile', baseURL: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys' },
  xai: { id: 'xai', name: 'xAI', defaultModel: 'grok-3-mini', baseURL: 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai' },
};

// Most specific prefix first: "sk-ant-" and "sk-or-" would otherwise match OpenAI's "sk-".
const PREFIXES: [string, ProviderId][] = [
  ['sk-ant-', 'anthropic'],
  ['sk-or-', 'openrouter'],
  ['gsk_', 'groq'],
  ['xai-', 'xai'],
  ['AIza', 'gemini'],
  ['AQ.', 'gemini'], // Google's newer key format
  ['sk-', 'openai'],
];

/** The provider for this key, or null when the prefix is unknown and NOCAP_PROVIDER isn't set. */
export function detectProvider(key: string, forced = process.env.NOCAP_PROVIDER): ProviderInfo | null {
  if (forced && forced in PROVIDERS) return PROVIDERS[forced as ProviderId];
  const k = key.trim();
  const hit = PREFIXES.find(([prefix]) => k.startsWith(prefix));
  return hit ? PROVIDERS[hit[1]] : null;
}
