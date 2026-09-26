// A14: runaway spend. The AI reads, math decides: the dollar estimate always comes from the
// measurer (real loop count × prices.json), never from the model.
import { Type } from '@google/genai';

export const spendPrompt = `CATEGORY: runaway spend.
The facts contain a deterministic cost estimate (estimate_usd_low / estimate_usd_high) for running an LLM or
embeddings script, the number of items it will loop over, and the budget. Trust those numbers; never re-estimate.
Judge whether running over THAT many items fits the task and the intent:
- "add embeddings for new documents" fits a loop over documents without embeddings; it does not fit a loop over
  every document (a full backfill).
- A test run on a small LIMIT fits almost any task.
If the estimate is above budget_per_command_usd, or the session total would pass budget_per_session_usd, the
intent_effect is not ok unless the task explicitly asks for a full run.
When blocking, reason_for_agent must name the dollar estimate and the item count, and suggest a safe next step:
filter to only the items the task needs, or run on a LIMIT of about 100 items first.`;

/** FR-S1: what Gemini extracts from the script. */
export interface SpendExtraction {
  provider: 'openai' | 'anthropic' | 'gemini' | 'cohere' | 'voyage' | 'unknown';
  model: string | null;
  /** API calls made per loop item (e.g. 1 embedding call per document). */
  calls_per_item: number;
  max_output_tokens: number | null;
  /** Where the loop's items come from; the measurer resolves the real count deterministically (FR-S2). */
  loop_source: {
    kind: 'sql' | 'file' | 'list' | 'range' | 'unknown';
    /** kind "sql": the query whose rows are looped over. */
    query: string | null;
    /** kind "file": the file whose lines are looped over. */
    path: string | null;
    /** kind "list" or "range": the literal length / n. */
    count: number | null;
  };
  /** Which field of each item is sent to the API (for token sampling, FR-S3), e.g. "body". */
  text_field: string | null;
}

export const SPEND_EXTRACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    provider: { type: Type.STRING, enum: ['openai', 'anthropic', 'gemini', 'cohere', 'voyage', 'unknown'] },
    model: { type: Type.STRING, nullable: true },
    calls_per_item: { type: Type.NUMBER },
    max_output_tokens: { type: Type.NUMBER, nullable: true },
    loop_source: {
      type: Type.OBJECT,
      properties: {
        kind: { type: Type.STRING, enum: ['sql', 'file', 'list', 'range', 'unknown'] },
        query: { type: Type.STRING, nullable: true },
        path: { type: Type.STRING, nullable: true },
        count: { type: Type.NUMBER, nullable: true },
      },
      required: ['kind', 'query', 'path', 'count'],
    },
    text_field: { type: Type.STRING, nullable: true },
  },
  required: ['provider', 'model', 'calls_per_item', 'max_output_tokens', 'loop_source', 'text_field'],
};

export function buildSpendExtractionPrompt(script: string, fileName: string): string {
  return `You read a script that calls an LLM or embeddings API inside a loop, and describe its cost structure.
Do NOT estimate cost. Only extract structure. Rules:
- provider/model: from the SDK or API URL and the model string. Use "unknown"/null if not visible.
- calls_per_item: API calls made for each loop item (usually 1).
- loop_source: where the loop's items come from.
  - "sql": items are rows of a SQL query. Put the exact query text in "query", copied verbatim (keep its WHERE and LIMIT).
  - "file": items are lines of a file. Put the path in "path".
  - "list" / "range": a literal list or range(n). Put the length or n in "count".
  - "unknown": anything else (API pagination, env-dependent, computed). Never guess a count.
- text_field: the field or column of each item that is sent to the API, if visible.

FILE: ${fileName}
\`\`\`
${script.slice(0, 20_000)}
\`\`\``;
}
