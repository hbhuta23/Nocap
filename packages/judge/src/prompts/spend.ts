// A14. The AI reads, math decides: the dollar estimate comes from the measurer, never from the model.
export const spendPrompt = `CATEGORY: runaway spend.
The dollar estimate in the facts is computed deterministically. Judge whether running the script over that many
items fits the task (e.g. "new documents" vs every document).
TODO(A14): tune against the eval set.`;

// FR-S1: separate extraction call. Gemini reads the script and returns this shape.
export interface SpendExtraction {
  provider: 'openai' | 'anthropic' | 'gemini' | 'cohere' | 'voyage' | 'unknown';
  model: string | null;
  calls_per_item: number;
  max_output_tokens: number | null;
  loop_source:
    | { kind: 'sql'; query: string }
    | { kind: 'file'; path: string }
    | { kind: 'list'; length: number }
    | { kind: 'range'; n: number }
    | { kind: 'unknown' };
}

// TODO(A14): export async function extractSpend(script: string): Promise<SpendExtraction>
