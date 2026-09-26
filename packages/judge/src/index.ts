// Gemini judge (A12). Owner: Role A.
// One call: task + intent + measured facts in, schema-checked JSON out.
// Any timeout or error falls back to rules only (FR-G5).

import { GoogleGenAI, Type } from '@google/genai';
import type { Judge, JudgeInput, JudgeResult } from '@nocap/shared';
import { JUDGE_TIMEOUT_MS } from '@nocap/shared';
import { buildPrompt } from './prompts';
import { redact } from './redact';

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
  },
  required: ['task_fit', 'intent_effect', 'suggested_verdict', 'headline', 'reason_for_agent'],
};

export interface GeminiJudgeOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  redactColumns?: string[];
}

export class GeminiJudge implements Judge {
  private ai: GoogleGenAI | null = null;
  private redactColumns: string[];

  constructor(private opts: GeminiJudgeOptions = {}) {
    this.redactColumns = opts.redactColumns ?? [];
  }

  // Settings are read on each call, not in the constructor: the daemon's pipeline builds its judge
  // at import time, before server.ts has loaded .env.
  private get model() {
    return this.opts.model ?? process.env.NOCAP_GEMINI_MODEL ?? 'gemini-3.8-flash';
  }

  private get timeoutMs() {
    return this.opts.timeoutMs ?? Number(process.env.NOCAP_JUDGE_TIMEOUT_MS ?? JUDGE_TIMEOUT_MS);
  }

  private client(): GoogleGenAI | null {
    const apiKey = this.opts.apiKey ?? process.env.GEMINI_API_KEY;
    if (!this.ai && apiKey) this.ai = new GoogleGenAI({ apiKey });
    return this.ai;
  }

  async judge(input: JudgeInput): Promise<JudgeResult> {
    const ai = this.client();
    if (!ai) return rulesOnly(input, 'no GEMINI_API_KEY set');

    const safeInput = { ...input, judgeContext: redact(input.judgeContext, this.redactColumns) };
    const prompt = buildPrompt(safeInput);

    // A17: one retry for transient errors (503 overloaded, 429 rate limit), then rules only.
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await withTimeout(
          ai.models.generateContent({
            model: this.model,
            contents: prompt,
            config: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0 },
          }),
          this.timeoutMs,
        );
        const parsed = JSON.parse(res.text ?? '{}') as Omit<JudgeResult, 'mode'>;
        return { ...parsed, mode: 'full' };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (!/\b(503|429|UNAVAILABLE|RESOURCE_EXHAUSTED)\b/.test(lastError)) break;
      }
    }
    return rulesOnly(input, lastError);
  }
}

/** FR-G5 fallback. The policy engine (Role B) decides the final verdict from facts + rules. */
export function rulesOnly(_input: JudgeInput, why: string): JudgeResult {
  return {
    task_fit: { ok: true, why: `judge unavailable (${why})` },
    intent_effect: { ok: true, why: `judge unavailable (${why})` },
    suggested_verdict: 'ask',
    headline: 'Checked by rules only',
    reason_for_agent: 'nocap could not reach its judge; this action needs the developer to confirm.',
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
