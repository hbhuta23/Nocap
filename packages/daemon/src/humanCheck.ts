// Human check flow (B14, FR-H1/H4–H6). Owner: Role B.
// Holds /v1/check open, emits human.needed, waits for /v1/human-intent, asks the judge, releases the verdict.

import type { HumanIntentRequest, HumanIntentResponse } from '@nocap/shared';
import { refuseReflexAnswer } from '@nocap/shared';

export async function submitHumanIntent(body: HumanIntentRequest): Promise<HumanIntentResponse> {
  if (body.answer !== undefined) {
    const refusal = refuseReflexAnswer(body.answer, body.ms_since_open);
    if (refusal) return { accepted: false, message: refusal };
  }
  // TODO(B14): look up the pending check by body.check_id, run the judge with speaker: 'human',
  // resolve the held /v1/check request, log to human_checks.
  return { accepted: true, match: true };
}
