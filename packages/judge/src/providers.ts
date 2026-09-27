// One JSON call to whichever provider the key belongs to (see shared/providers.ts).
// Gemini: @google/genai with its own schema. Anthropic: structured outputs. OpenAI and OpenAI-compatible
// (OpenRouter, Groq, xAI, a local server via NOCAP_BASE_URL): chat completions.

import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { detectProvider, PROVIDERS, type ProviderInfo } from '@nocap/shared';

export interface JsonClient {
  provider: ProviderInfo;
  model: string;
  /** Returns the model's JSON text. `schema` is in Gemini's format; other providers get it converted. */
  generate(prompt: string, schema: object, timeoutMs: number): Promise<string>;
}

/** The key from the extension (SecretStorage) or .env. Only nocap's own variables: a project's OPENAI_API_KEY is its own business. */
export function currentKey(): string | undefined {
  return process.env.NOCAP_API_KEY || process.env.GEMINI_API_KEY || undefined;
}

export function makeClient(apiKey: string, modelOverride?: string): JsonClient | null {
  // A key given as GEMINI_API_KEY is Gemini whatever its format; a custom endpoint speaks OpenAI's API.
  const provider =
    detectProvider(apiKey) ??
    (apiKey === process.env.GEMINI_API_KEY ? PROVIDERS.gemini : null) ??
    (process.env.NOCAP_BASE_URL ? PROVIDERS.openai : null);
  if (!provider) return null;
  const model =
    modelOverride ?? process.env.NOCAP_MODEL ?? (provider.id === 'gemini' ? process.env.NOCAP_GEMINI_MODEL : undefined) ?? provider.defaultModel;

  if (provider.id === 'gemini') {
    const ai = new GoogleGenAI({ apiKey });
    return {
      provider,
      model,
      async generate(prompt, schema) {
        const res = await ai.models.generateContent({
          model,
          contents: prompt,
          config: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0 },
        });
        return res.text ?? '{}';
      },
    };
  }

  if (provider.id === 'anthropic') {
    const client = new Anthropic({ apiKey, maxRetries: 0 });
    return {
      provider,
      model,
      async generate(prompt, schema, timeoutMs) {
        const res = await client.messages.create(
          {
            model,
            max_tokens: 2048,
            temperature: 0,
            messages: [{ role: 'user', content: prompt }],
            output_config: { format: { type: 'json_schema', schema: toJsonSchema(schema) } },
          },
          { timeout: timeoutMs },
        );
        if (res.stop_reason === 'refusal') throw new Error('the model declined to judge this action');
        const text = res.content.find((b) => b.type === 'text');
        return text?.type === 'text' ? text.text : '{}';
      },
    };
  }

  // OpenAI and compatibles. OpenAI itself enforces the schema; the others get JSON mode plus the schema in the prompt,
  // since strict schemas aren't supported on every model they serve.
  const client = new OpenAI({ apiKey, baseURL: process.env.NOCAP_BASE_URL ?? provider.baseURL, maxRetries: 0 });
  const strict = provider.id === 'openai' && !process.env.NOCAP_BASE_URL;
  return {
    provider,
    model,
    async generate(prompt, schema, timeoutMs) {
      const json = toJsonSchema(schema);
      const res = await client.chat.completions.create(
        strict
          ? {
              model,
              messages: [{ role: 'user', content: prompt }],
              response_format: { type: 'json_schema', json_schema: { name: 'verdict', strict: true, schema: json } },
              reasoning_effort: 'none',
            }
          : {
              model,
              temperature: 0,
              messages: [{ role: 'user', content: `${prompt}\n\nReply with only a JSON object matching this JSON Schema:\n${JSON.stringify(json)}` }],
              response_format: { type: 'json_object' },
            },
        { timeout: timeoutMs },
      );
      return res.choices[0]?.message?.content ?? '{}';
    },
  };
}

/** A cheap authenticated request, so a typo'd or revoked key is caught before it's saved. */
export async function checkKey(apiKey: string): Promise<{ ok: boolean; provider?: string; error?: string }> {
  const provider = detectProvider(apiKey);
  if (!provider) {
    return { ok: false, error: "That key's format isn't one nocap recognises (Gemini, Anthropic, OpenAI, OpenRouter, Groq or xAI)." };
  }
  try {
    if (provider.id === 'gemini') await new GoogleGenAI({ apiKey }).models.list({ config: { pageSize: 1 } });
    else if (provider.id === 'anthropic') await new Anthropic({ apiKey, maxRetries: 0, timeout: 8000 }).models.list({ limit: 1 });
    else {
      const client = new OpenAI({ apiKey, baseURL: provider.baseURL, maxRetries: 0, timeout: 8000 });
      // OpenRouter lists models without auth, so ask about the key itself.
      if (provider.id === 'openrouter') await client.get('/key');
      else await client.models.list();
    }
    return { ok: true, provider: provider.name };
  } catch (err) {
    return { ok: false, provider: provider.name, error: err instanceof Error ? err.message : String(err) };
  }
}

/** HTTP status of an SDK error, when it has one (all three SDKs set `status`). */
export function errorStatus(err: unknown): number | undefined {
  const s = (err as { status?: unknown })?.status;
  return typeof s === 'number' ? s : undefined;
}

type GeminiSchema = { type?: string; properties?: Record<string, GeminiSchema>; items?: GeminiSchema; enum?: string[]; nullable?: boolean };

/**
 * Gemini schema → JSON Schema for structured outputs (Anthropic, OpenAI strict). Both require
 * `additionalProperties: false` and every property listed in `required`; optional fields become nullable.
 */
export function toJsonSchema(schema: object): Record<string, unknown> {
  const s = schema as GeminiSchema;
  const type = String(s.type ?? 'string').toLowerCase();
  let out: Record<string, unknown>;
  if (type === 'object') {
    const props = s.properties ?? {};
    const required = new Set((schema as { required?: string[] }).required ?? []);
    out = {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(props).map(([k, v]) => [k, toJsonSchema(required.has(k) || v.nullable ? v : { ...v, nullable: true })]),
      ),
      required: Object.keys(props),
      additionalProperties: false,
    };
  } else if (type === 'array') {
    out = { type: 'array', items: toJsonSchema(s.items ?? {}) };
  } else {
    out = { type, ...(s.enum ? { enum: s.enum } : {}) };
  }
  return s.nullable ? { anyOf: [out, { type: 'null' }] } : out;
}
