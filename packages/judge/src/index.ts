// The judge (A12). Owner: Role A. Gemini by default; any provider whose key the user gives (providers.ts).
// One call: task + intent + measured facts in, schema-checked JSON out.
// Any timeout or error falls back to rules only (FR-G5).

import { Type } from '@google/genai';
import type { Judge, JudgeInput, JudgeResult } from '@nocap/shared';
import { JUDGE_TIMEOUT_MS } from '@nocap/shared';
import { buildPrompt } from './prompts';
import { buildSpendExtractionPrompt, SPEND_EXTRACTION_SCHEMA, type SpendExtraction } from './prompts/spend';
import { redact } from './redact';
import { currentKey, errorStatus, makeClient, type JsonClient } from './providers';

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    task_fit: {
      type: Type.OBJECT,
      properties: { ok: { type: Type.BOOLEAN }, why: { type: Type.STRING } },
      required: ['ok', 'why'],
    },
    intent_effect: {
      type: Type.OBJECT,
      properties: { ok: { type: Type.BOOLEAN }, why: { type: Type.STRING } },
      required: ['ok', 'why'],
    },
    suggested_verdict: { type: Type.STRING, enum: ['allow', 'warn', 'block', 'ask'] },
    headline: { type: Type.STRING },
    reason_for_agent: { type: Type.STRING },
    violated_rule: { type: Type.STRING, nullable: true },
  },
  required: ['task_fit', 'intent_effect', 'suggested_verdict', 'headline', 'reason_for_agent'],
};

export interface LlmJudgeOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  /** Always redacted, on top of any per-call `redactColumns`. */
  redactColumns?: string[];
}

export class LlmJudge implements Judge {
  private ai: JsonClient | null = null;
  private aiKey: string | undefined;

  constructor(private opts: LlmJudgeOptions = {}) {}

  // Settings are read on each call, not in the constructor: the daemon's pipeline builds its judge
  // at import time, before server.ts has loaded .env.
  private get timeoutMs() {
    return this.opts.timeoutMs ?? Number(process.env.NOCAP_JUDGE_TIMEOUT_MS ?? JUDGE_TIMEOUT_MS);
  }

  /** Rebuilt when the key changes (the extension can hand the daemon a new key at runtime). */
  client(): JsonClient | null {
    const apiKey = this.opts.apiKey ?? currentKey();
    if (!apiKey) return null;
    if (!this.ai || this.aiKey !== apiKey) {
      this.ai = makeClient(apiKey, this.opts.model);
      this.aiKey = apiKey;
    }
    return this.ai;
  }

  async judge(input: JudgeInput): Promise<JudgeResult> {
    // FR-G7: strip redacted columns (from .nocap.yml) and secret-looking strings before anything leaves the machine.
    const columns = [...(this.opts.redactColumns ?? []), ...(input.redactColumns ?? [])];
    const safeInput = { ...input, judgeContext: redact(input.judgeContext, columns) };
    const result = await this.generate<Omit<JudgeResult, 'mode'>>(buildPrompt(safeInput), RESPONSE_SCHEMA);
    return result.ok ? { ...result.value, mode: 'full' } : rulesOnly(input, result.error);
  }

  /**
   * FR-S1: read a script that calls an LLM API and describe its cost structure.
   * The AI reads, math decides: this returns structure only. The dollar estimate is computed by the
   * spend measurer from the real loop count and prices.json. Returns null when the judge is unavailable.
   */
  async extractSpend(script: string, fileName = 'script'): Promise<SpendExtraction | null> {
    const result = await this.generate<SpendExtraction>(buildSpendExtractionPrompt(redact(script, []), fileName), SPEND_EXTRACTION_SCHEMA);
    return result.ok ? result.value : null;
  }

  /** One JSON call to the provider. A17: one retry for transient errors (503 overloaded, 429 rate limit). */
  private async generate<T>(prompt: string, schema: object): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
    const ai = this.client();
    if (!ai) return { ok: false, error: currentKey() ? 'unrecognised API key' : 'no API key set' };

    let error = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await withTimeout(ai.generate(prompt, schema, this.timeoutMs), this.timeoutMs);
        return { ok: true, value: JSON.parse(text) as T };
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        const status = errorStatus(err);
        const transient = status === 429 || (status !== undefined && status >= 500) || /\b(503|529|429|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded)\b/i.test(error);
        if (!transient) break;
      }
    }
    return { ok: false, error };
  }
}

/** FR-G5 fallback. The policy engine (Role B) decides the final verdict from facts + rules. */
export function rulesOnly(_input: JudgeInput, why: string): JudgeResult {
  return {
    task_fit: { ok: true, why: `judge unavailable (${why})` },
    intent_effect: { ok: true, why: `judge unavailable (${why})` },
    suggested_verdict: 'ask',
    headline: 'Checked by rules only',
    reason_for_agent: 'Nocap could not reach its judge; this action needs the developer to confirm.',
    mode: 'rules_only',
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`judge timed out after ${ms} ms`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

export { redact } from './redact';
export { checkKey, toJsonSchema } from './providers';
/** Old name, kept for existing callers. */
export const GeminiJudge = LlmJudge;
export type { SpendExtraction } from './prompts/spend';
