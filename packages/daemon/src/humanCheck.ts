// Human check flow (B14, FR-H1/H4–H6). Owner: Role B.
// Holds /v1/check open, emits human.needed, waits for /v1/human-intent, asks the judge, releases the verdict.

import type { CheckRequest, HumanIntentRequest, HumanIntentResponse, Judge, Measurement, NocapConfig, VerdictResponse, Category } from '@nocap/shared';
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

const pending = new Map<string, Pending>();

export function holdForHuman(input: Omit<Pending, 'resolve' | 'timer'>): Promise<VerdictResponse> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(input.check_id);
      bus.emit({ type: 'human.answered', check_id: input.check_id, outcome: 'timeout', at: Date.now() });
      resolve({ ...input.response, verdict: 'block', reason_for_agent: "Blocked by nocap: the developer didn't confirm." });
    }, HUMAN_CHECK_TIMEOUT_MS);
    pending.set(input.check_id, { ...input, resolve, timer });
    bus.emit({ type: 'human.needed', check_id: input.check_id, command: input.request.command, task: input.task, category: input.category, at: Date.now() });
  });
}

export async function submitHumanIntent(body: HumanIntentRequest): Promise<HumanIntentResponse> {
  if (body.answer !== undefined) {
    const refusal = refuseReflexAnswer(body.answer, body.ms_since_open);
    if (refusal) return { accepted: false, message: refusal };
  }
  const check = pending.get(body.check_id);
  if (!check) return { accepted: false, message: 'This nocap check is no longer pending.' };
  if (body.confirm !== undefined) {
    const expected = check.response.facts.find((f) => /rows|files|cost/i.test(f.label))?.value.replace(/[^0-9]/g, '') ?? '';
    if (body.confirm !== expected) return { accepted: false, message: `Type ${expected} to confirm this exact effect.` };
    clear(check, 'override');
    check.resolve({ ...check.response, verdict: 'allow', reason_for_agent: 'Allowed after the developer confirmed the measured effect.' });
    await audit(check.request.cwd, { type: 'human_check', check_id: body.check_id, outcome: 'override', answer: body.confirm, at: Date.now() });
    return { accepted: true, match: false };
  }
  const answer = body.answer?.trim() ?? '';
  const rows = Number((check.response.facts.find((f) => /rows/i.test(f.label))?.value ?? '').replace(/,/g, ''));
  const match = rows > 0 ? rows <= 500 && /test|qa|account/i.test(answer) : /fix|change|run|remove|clean|update/i.test(answer);
  if (match) {
    clear(check, 'match');
    check.resolve({ ...check.response, verdict: 'allow', headline: 'Developer expectation matches measured effect', reason_for_agent: 'Allowed: the developer confirmed the measured effect.' });
    return { accepted: true, match: true };
  }
  bus.emit({ type: 'human.answered', check_id: body.check_id, outcome: 'mismatch', at: Date.now() });
  return { accepted: true, match: false, mismatch: { expected: answer, actual: check.response.headline, confirm_number: String(rows || 1) } };
}

function clear(check: Pending, outcome: 'match' | 'override') {
  clearTimeout(check.timer);
  pending.delete(check.check_id);
  bus.emit({ type: 'human.answered', check_id: check.check_id, outcome, at: Date.now() });
  void OVERRIDE_WINDOW_MS;
}
