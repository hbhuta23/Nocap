// FR-H3: refuse reflex answers in the human intent pop-up.
// Shared so the extension can refuse instantly and the daemon can re-check.

const REFLEX_WORDS = new Set(['y', 'yes', 'yep', 'yeah', 'ok', 'okay', 'k', 'go', 'sure', 'fine', 'do it', 'lgtm', 'approve']);
const MIN_WORDS = 4;
const MIN_MS_OPEN = 2_000;

export const REFLEX_REFUSAL = 'Tell nocap what you expect this to do.';

/** Returns a refusal message, or null if the answer is acceptable. */
export function refuseReflexAnswer(answer: string, msSinceOpen: number): string | null {
  const trimmed = answer.trim().toLowerCase().replace(/[.!]+$/, '');
  if (msSinceOpen < MIN_MS_OPEN) return REFLEX_REFUSAL;
  if (REFLEX_WORDS.has(trimmed)) return REFLEX_REFUSAL;
  if (trimmed.split(/\s+/).filter(Boolean).length < MIN_WORDS) return REFLEX_REFUSAL;
  return null;
}
