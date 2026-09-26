// A10: the rubber-stamp guard pop-up (FR-H1..H5).
// Native input box for now (fast to build, focus-safe). Swap in a webview for Role C's
// mismatch design once the flow works end to end.
//
// Rules learned from the first live test:
// - Pop-ups are queued and shown one at a time. VS Code shows only one input box, so a new one
//   used to silently cancel the one being answered.
// - Escape declines: we tell the daemon so the agent is released now, not after the 5-minute timeout.
// - When a check ends elsewhere (timeout, answered), its pop-up closes or is skipped.
import * as vscode from 'vscode';
import type { HumanIntentResponse, HumanOutcome, StreamEvent } from '@nocap/shared';
import { refuseReflexAnswer } from '@nocap/shared';
import { daemon } from '../daemonClient';

type HumanNeeded = Extract<StreamEvent, { type: 'human.needed' }>;

const queue: HumanNeeded[] = [];
const finished = new Set<string>();
let current: { checkId: string; box: vscode.InputBox } | null = null;
let draining = false;

/** Called for every `human.needed` stream event. */
export function enqueueHumanIntent(e: HumanNeeded) {
  queue.push(e);
  void drain();
}

/** Called for every `human.answered` stream event. */
export function onHumanAnswered(checkId: string, outcome: HumanOutcome) {
  // Not final: after "mismatch" the developer types the confirm number; after "refused" they answer again.
  if (outcome === 'mismatch' || outcome === 'refused') return;
  finished.add(checkId);
  if (current?.checkId === checkId) current.box.hide();
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const e = queue.shift()!;
      if (!finished.has(e.check_id)) await askHumanIntent(e);
    }
  } finally {
    draining = false;
  }
}

async function askHumanIntent(e: HumanNeeded) {
  const title = `nocap: ${shorten(e.command)}`;
  let message: string | undefined;

  for (;;) {
    const opened = Date.now();
    const answer = await prompt(e.check_id, {
      title,
      // FR-H2: ask before revealing. Never show measured numbers here.
      prompt: message ?? 'What do you expect this to do? (Escape = decline)',
      validate: (v) => (v.length > 0 ? refuseReflexAnswer(v, Number.MAX_SAFE_INTEGER) : null),
    });
    if (answer === undefined) return decline(e.check_id);

    const res = await daemon.post<HumanIntentResponse>('/v1/human-intent', {
      check_id: e.check_id,
      answer,
      ms_since_open: Date.now() - opened,
    });
    if (!res.accepted) {
      if (!isPending(e.check_id, res)) return;
      message = res.message;
      continue;
    }
    if (res.match || !res.mismatch) return;
    return confirmMismatch(e, title, res.mismatch);
  }
}

async function confirmMismatch(e: HumanNeeded, title: string, m: NonNullable<HumanIntentResponse['mismatch']>) {
  let message = `CAP DETECTED. You expected: ${m.expected}. This actually: ${m.actual}. Type ${m.confirm_number} to run it anyway (Escape = decline).`;

  for (;;) {
    const opened = Date.now();
    // FR-H5: GitHub-style "type the number to run anyway".
    const typed = await prompt(e.check_id, { title, prompt: message });
    if (typed === undefined) return decline(e.check_id);

    const res = await daemon.post<HumanIntentResponse>('/v1/human-intent', {
      check_id: e.check_id,
      confirm: typed.trim(),
      ms_since_open: Date.now() - opened,
    });
    if (res.accepted || !isPending(e.check_id, res)) return;
    message = res.message ?? message;
  }
}

async function decline(checkId: string) {
  // Closed because the check already ended elsewhere: nothing to tell the daemon.
  if (finished.has(checkId)) return;
  await daemon.post('/v1/human-intent', { check_id: checkId, cancel: true, ms_since_open: 0 }).catch(() => {});
}

function isPending(checkId: string, res: HumanIntentResponse) {
  const gone = /no longer pending/i.test(res.message ?? '');
  if (gone) finished.add(checkId);
  return !gone;
}

/** An input box we can close from code (showInputBox can't be), so stale pop-ups disappear. */
function prompt(
  checkId: string,
  opts: { title: string; prompt: string; validate?: (v: string) => string | null },
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const box = vscode.window.createInputBox();
    box.title = opts.title;
    box.prompt = opts.prompt;
    box.ignoreFocusOut = true;
    let done = false;
    const finish = (value: string | undefined) => {
      if (done) return;
      done = true;
      current = null;
      box.dispose();
      resolve(value);
    };
    box.onDidChangeValue((v) => (box.validationMessage = opts.validate?.(v) ?? undefined));
    box.onDidAccept(() => {
      if (!box.value.trim() || opts.validate?.(box.value)) return;
      finish(box.value);
    });
    box.onDidHide(() => finish(undefined));
    current = { checkId, box };
    box.show();
  });
}

function shorten(command: string, max = 100) {
  const oneLine = command.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine;
}
