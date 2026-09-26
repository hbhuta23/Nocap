// A10: the rubber-stamp guard pop-up (FR-H1..H5).
// First version uses a native input box (fast to build, focus-safe). Swap in a webview for
// Role C's mismatch design once the flow works end to end.
import * as vscode from 'vscode';
import type { HumanIntentResponse, StreamEvent } from '@nocap/shared';
import { refuseReflexAnswer } from '@nocap/shared';
import { daemon } from '../daemonClient';

type HumanNeeded = Extract<StreamEvent, { type: 'human.needed' }>;

export async function askHumanIntent(e: HumanNeeded) {
  let message: string | undefined;

  // Loop until the answer is accepted or the human cancels (cancel = deny, FR-H1).
  for (;;) {
    const opened = Date.now();
    const answer = await vscode.window.showInputBox({
      title: `nocap: ${e.command}`,
      // FR-H2: ask before revealing. Never show measured numbers here.
      prompt: message ?? 'What do you expect this to do?',
      ignoreFocusOut: true,
      validateInput: (v) => (v.length > 0 && refuseReflexAnswer(v, Number.MAX_SAFE_INTEGER)) || null,
    });
    if (answer === undefined) return; // daemon times out → deny

    const res = await daemon.post<HumanIntentResponse>('/v1/human-intent', {
      check_id: e.check_id,
      answer,
      ms_since_open: Date.now() - opened,
    });
    if (!res.accepted) {
      message = res.message;
      continue;
    }
    if (res.match || !res.mismatch) return;
    return confirmMismatch(e, res.mismatch);
  }
}

async function confirmMismatch(e: HumanNeeded, m: NonNullable<HumanIntentResponse['mismatch']>) {
  const opened = Date.now();
  // FR-H5: GitHub-style "type the number to run anyway".
  const typed = await vscode.window.showInputBox({
    title: 'CAP DETECTED',
    prompt: `You expected: ${m.expected}. This actually: ${m.actual}. Type ${m.confirm_number} to run it anyway.`,
    ignoreFocusOut: true,
  });
  if (typed === undefined) return;
  await daemon.post('/v1/human-intent', { check_id: e.check_id, confirm: typed, ms_since_open: Date.now() - opened });
}
