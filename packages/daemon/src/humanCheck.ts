// Human check flow (B14, FR-H1/H4–H6). Owner: Role B.
// Holds /v1/check open, emits human.needed, waits for /v1/human-intent, asks the judge, releases the verdict.

import type { CheckRequest, HumanIntentRequest, HumanIntentResponse, Judge, Measurement, NocapConfig, VerdictResponse, Category, StreamEvent } from '@nocap/shared';
import { refuseReflexAnswer } from '@nocap/shared';
import { HUMAN_CHECK_TIMEOUT_MS, OVERRIDE_WINDOW_MS } from '@nocap/shared';
import { bus } from './bus';
import { audit } from './audit';

interface Pending {
  check_id: string;
  request: CheckRequest;
  response: VerdictResponse;
  task: string | null;
  category: Category;
  measurement: Measurement;
  config: NocapConfig;
  judge: Judge;
  resolve: (response: VerdictResponse) => void;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, Pending & { event: HumanNeeded }>();

type HumanNeeded = Extract<StreamEvent, { type: 'human.needed' }>;

/** How long to wait for a VS Code window to connect (e.g. one that is still starting) before giving up. */
const NO_WINDOW_GRACE_MS = 3_000;

export async function holdForHuman(input: Omit<Pending, 'resolve' | 'timer'>): Promise<VerdictResponse> {
  // Nobody can see a pop-up (VS Code is closed): say so now instead of holding the agent for the full timeout.
  for (let waited = 0; bus.listenerCount() === 0 && waited < NO_WINDOW_GRACE_MS; waited += 250) await new Promise((r) => setTimeout(r, 250));
  if (bus.listenerCount() === 0) {
    bus.emit({ type: 'human.answered', check_id: input.check_id, outcome: 'timeout', at: Date.now() });
    return {
      ...input.response,
      verdict: 'block',
      reason_for_agent:
        "Blocked by Nocap: this needs the developer's OK in Nocap's pop-up, but no VS Code window with Nocap is open. Tell the developer to open VS Code, then retry this exact command.",
    };
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(input.check_id);
      bus.emit({ type: 'human.answered', check_id: input.check_id, outcome: 'timeout', at: Date.now() });
      resolve({ ...input.response, verdict: 'block', reason_for_agent: "Blocked by Nocap: the developer didn't confirm." });
    }, HUMAN_CHECK_TIMEOUT_MS);
    const event: HumanNeeded = { type: 'human.needed', check_id: input.check_id, agent: input.request.agent, command: input.request.command, task: input.task, category: input.category, at: Date.now(), cwd: input.request.cwd, unclaimed: !bus.claimed(input.request.cwd) };
    pending.set(input.check_id, { ...input, resolve, timer, event });
    bus.emit(event);
  });
}

/** Pop-ups still waiting for an answer, replayed to a window that connects late (VS Code reopened, reloaded). */
export function pendingHumanChecks(): HumanNeeded[] {
  return [...pending.values()].map((p) => ({ ...p.event, unclaimed: !bus.claimed(p.request.cwd) }));
}

export async function submitHumanIntent(body: HumanIntentRequest): Promise<HumanIntentResponse> {
  if (body.cancel) {
    // Escape in the pop-up: release the agent now with a deny instead of holding it until the 5-minute timeout.
    const check = pending.get(body.check_id);
    if (!check) return { accepted: true };
    clearTimeout(check.timer);
    pending.delete(check.check_id);
    bus.emit({ type: 'human.answered', check_id: check.check_id, outcome: 'declined', at: Date.now() });
    check.resolve({ ...check.response, verdict: 'block', reason_for_agent: 'Blocked by Nocap: the developer declined this action. Ask them what they want instead.' });
    await audit(check.request.cwd, { type: 'human_check', check_id: body.check_id, outcome: 'declined', at: Date.now() });
    return { accepted: true };
  }
  if (body.answer !== undefined) {
    const refusal = refuseReflexAnswer(body.answer, body.ms_since_open);
    if (refusal) {
      // Counted by the panel as a blind approval prevented (FR-H6). Not final: the pop-up stays open.
      bus.emit({ type: 'human.answered', check_id: body.check_id, outcome: 'refused', at: Date.now() });
      return { accepted: false, message: refusal };
    }
  }
  const check = pending.get(body.check_id);
  if (!check) return { accepted: false, message: 'This Nocap check is no longer pending.' };
  // A broken team rule is the team's standard, not a question of what the developer expects: describing the
  // action correctly never unlocks it. Only an explicit "override" does (logged like any override).
  const brokenRule = check.response.facts.find((f) => f.label === 'Team rule broken')?.value;
  const confirmNumber = brokenRule ? 'override' : keyNumber(check.response.facts);
  if (body.confirm !== undefined) {
    // FR-H5: the typed number must match the key measured number (e.g. 48213 rows).
    const typed = /^\d+$/.test(confirmNumber) ? body.confirm.replace(/[^0-9]/g, '') : body.confirm.trim().toLowerCase();
    if (typed !== confirmNumber) return { accepted: false, message: `Type ${confirmNumber} to confirm this exact effect.` };
    clear(check, 'override');
    check.resolve({ ...check.response, verdict: 'allow', human_confirmed: true, reason_for_agent: 'Allowed after the developer confirmed the measured effect.' });
    await audit(check.request.cwd, { type: 'human_check', check_id: body.check_id, outcome: 'override', answer: body.confirm, at: Date.now() });
    return { accepted: true, match: false };
  }

  // FR-H4: the judge compares the developer's expectation with the measured effect, exactly as it does
  // for the agent's intent. Keyword matching is only the fallback when the judge is unavailable.
  const answer = body.answer?.trim() ?? '';
  const judged = await check.judge.judge({
    task: check.task,
    intent: answer,
    speaker: 'human',
    category: check.category,
    judgeContext: check.measurement.judgeContext,
    redactColumns: check.config.database?.redact_columns,
  });
  const match = judged.mode === 'full' ? judged.intent_effect.ok : keywordMatch(answer, check.response.facts);
  await audit(check.request.cwd, { type: 'human_check', check_id: body.check_id, answer, ms_to_answer: body.ms_since_open, match, judge_mode: judged.mode, why: judged.intent_effect.why, at: Date.now() });

  if (match && !brokenRule) {
    clear(check, 'match');
    check.resolve({ ...check.response, verdict: 'allow', human_confirmed: true, headline: 'Developer expectation matches measured effect', reason_for_agent: 'Allowed: the developer confirmed the measured effect.' });
    return { accepted: true, match: true };
  }
  bus.emit({ type: 'human.answered', check_id: body.check_id, outcome: 'mismatch', at: Date.now() });
  const actual = brokenRule
    ? `it breaks your team rule "${brokenRule}"`
    : judged.mode === 'full'
      ? judged.intent_effect.why
      : check.response.headline;
  return { accepted: true, match: false, mismatch: { expected: answer, actual, confirm_number: confirmNumber } };
}

/** The number the developer must type to override (FR-H5): the first high-severity fact with a number. */
function keyNumber(facts: VerdictResponse['facts']): string {
  // Only a real, non-zero number makes sense to type ("Files affected: 0" used to ask for "0").
  const withNumber = facts.filter((f) => f.label !== 'Team rule broken' && Number(f.value.replace(/,/g, '').match(/\d+/)?.[0] ?? 0) > 0);
  const fact = withNumber.find((f) => f.severity === 'high') ?? withNumber[0];
  // "48,213" → "48213", "$340.00" → "340"
  // No number to confirm (e.g. a broken team rule): type the word instead.
  return fact?.value.replace(/,/g, '').match(/\d+/)?.[0] ?? 'override';
}

/** Role B's original heuristic, kept for rules-only mode (no judge). */
function keywordMatch(answer: string, facts: VerdictResponse['facts']): boolean {
  const rows = Number((facts.find((f) => /rows/i.test(f.label))?.value ?? '').replace(/,/g, ''));
  return rows > 0 ? rows <= 500 && /test|qa|account/i.test(answer) : /fix|change|run|remove|clean|update/i.test(answer);
}

function clear(check: Pending, outcome: 'match' | 'override') {
  clearTimeout(check.timer);
  pending.delete(check.check_id);
  bus.emit({ type: 'human.answered', check_id: check.check_id, outcome, at: Date.now() });
  void OVERRIDE_WINDOW_MS;
}
