// A10: the rubber-stamp guard pop-up (FR-H1..H5), as a centered card in the editor area
// (VS Code has no floating windows; a focused webview panel is the closest thing to a modal).
// UI: media/approval.{js,css}. Rules learned from live tests:
// - one pop-up at a time, queued (overlapping pop-ups used to cancel each other)
// - Decline, Escape and closing the tab all DECLINE: the daemon blocks the command at once and tells the agent
// - when a check ends anywhere else (another window, the 5-minute timeout), its pop-up closes itself
// - pop-ups still waiting when VS Code reopens are replayed by the daemon; duplicates are skipped
// - the card can be dragged by its header (double-click to re-centre); the whole tab can be dragged to another group
import * as vscode from 'vscode';
import type { HumanIntentResponse, HumanOutcome, StreamEvent } from '@nocap/shared';
import { daemon } from '../daemonClient';

type HumanNeeded = Extract<StreamEvent, { type: 'human.needed' }>;

const AGENTS: Record<string, string> = {
  'claude-code': 'Claude Code', codex: 'Codex', 'gemini-cli': 'Gemini CLI', antigravity: 'Antigravity',
  'vscode-chat': 'VS Code chat', cursor: 'Cursor', unknown: 'An agent in the terminal',
};

const queue: HumanNeeded[] = [];
const finished = new Set<string>();
let current: { checkId: string; close: (message?: string) => void } | null = null;
let draining = false;
let extensionUri: vscode.Uri;
/** Where the developer dragged the card, as an offset from the centre (reset by double-clicking its header). */
let cardPos = { x: 0, y: 0 };

export function initHumanIntent(uri: vscode.Uri) {
  extensionUri = uri;
}

/** Called for every `human.needed` stream event. */
export function enqueueHumanIntent(e: HumanNeeded) {
  // The daemon replays waiting pop-ups when the stream reconnects: skip ones already shown, queued or done.
  if (finished.has(e.check_id) || current?.checkId === e.check_id || queue.some((q) => q.check_id === e.check_id)) return;
  queue.push(e);
  void drain();
}

/** Called for every `human.answered` stream event. */
export function onHumanAnswered(checkId: string, outcome: HumanOutcome) {
  // Not final: after "mismatch" the developer types the confirm word; after "refused" they answer again.
  if (outcome === 'mismatch' || outcome === 'refused') return;
  finished.add(checkId);
  if (current?.checkId === checkId) current.close(outcome === 'timeout' ? 'Timed out. The command was blocked.' : undefined);
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const e = queue.shift()!;
      if (!finished.has(e.check_id)) await ask(e);
    }
  } finally {
    draining = false;
  }
}

async function decline(checkId: string) {
  if (finished.has(checkId)) return;
  finished.add(checkId);
  await daemon.post('/v1/human-intent', { check_id: checkId, cancel: true, ms_since_open: 0 }).catch(() => {});
}

function ask(e: HumanNeeded): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    'nocap.approval',
    'Nocap: approve?',
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')] },
  );
  panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'logo.svg');
  const webview = panel.webview;
  const media = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', f)).toString();
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  webview.html = `<!doctype html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><link rel="stylesheet" href="${media('approval.css')}"></head>
<body><main id="card" class="card"></main><script nonce="${nonce}" src="${media('approval.js')}"></script></body></html>`;

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (after = 0) => {
      if (settled) return;
      settled = true;
      current = null;
      setTimeout(() => {
        panel.dispose();
        resolve();
      }, after);
    };
    current = {
      checkId: e.check_id,
      close: (message) => {
        void webview.postMessage({ type: 'closed', message });
        finish(message ? 1500 : 0);
      },
    };

    const post = <T>(body: object) => daemon.post<T>('/v1/human-intent', { check_id: e.check_id, ...body });
    const gone = (r: HumanIntentResponse) => /no longer pending/i.test(r.message ?? '');

    webview.onDidReceiveMessage(async (m) => {
      if (settled) return;
      try {
        if (m.type === 'ready') {
          void webview.postMessage({
            type: 'init',
            command: e.command,
            task: e.task,
            category: e.category,
            agent: AGENTS[e.agent ?? 'unknown'] ?? 'An agent',
            logo: media('logo.svg'),
            pos: cardPos,
          });
        } else if (m.type === 'moved') {
          cardPos = m.pos; // the next pop-up opens where the developer left this one
        } else if (m.type === 'decline') {
          await decline(e.check_id);
          finish(900);
        } else if (m.type === 'answer') {
          const res = await post<HumanIntentResponse>({ answer: m.answer, ms_since_open: m.ms });
          if (!res.accepted) {
            if (gone(res)) return finish();
            void webview.postMessage({ type: 'refused', message: res.message });
          } else if (res.match || !res.mismatch) {
            finished.add(e.check_id);
            void webview.postMessage({ type: 'approved' });
            finish(900);
          } else {
            void webview.postMessage({ type: 'mismatch', ...res.mismatch });
          }
        } else if (m.type === 'confirm') {
          const res = await post<HumanIntentResponse>({ confirm: m.confirm, ms_since_open: m.ms });
          if (res.accepted) {
            finished.add(e.check_id);
            void webview.postMessage({ type: 'approved' });
            finish(900);
          } else if (gone(res)) {
            finish();
          } else {
            void webview.postMessage({ type: 'confirm-refused', message: res.message });
          }
        }
      } catch {
        void webview.postMessage({ type: 'closed', message: 'Nocap is offline. The command was blocked.' });
        finish(1500);
      }
    });

    // Closing the tab counts as Decline, never as silent approval.
    panel.onDidDispose(() => {
      if (settled) return;
      settled = true;
      current = null;
      void decline(e.check_id);
      resolve();
    });
  });
}
