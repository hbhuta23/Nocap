// Nocap in one VS Code window only shows its own workspace. The daemon on :7777 is shared by every window,
// so each window filters the stream by where the agent is working.
import * as vscode from 'vscode';
import { sep } from 'node:path';
import type { StreamEvent } from '@nocap/shared';

export function workspaceRoots(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

/** Is this path in one of this window's workspace folders? Unknown (events from older daemons) counts as yes. */
export function isMine(cwd: string | undefined): boolean {
  if (!cwd) return true;
  return workspaceRoots().some((root) => cwd === root || cwd.startsWith(root.endsWith(sep) ? root : root + sep));
}

/** Check ids that belong to this workspace, learned from check.started / check.finished. */
const mineIds = new Set<string>();

/** Whether this window should see the event (pop-ups, notifications, the panel). */
export function eventIsMine(e: StreamEvent): boolean {
  switch (e.type) {
    case 'check.started':
    case 'check.finished': {
      const mine = isMine(e.request.cwd);
      if (mine) mineIds.add(e.check_id);
      return mine;
    }
    case 'human.needed':
      return e.unclaimed === true || isMine(e.cwd);
    case 'human.answered':
      return mineIds.has(e.check_id);
    case 'task.updated':
      return isMine(e.cwd);
  }
}

/** The panel's own session for this workspace (a task typed there applies only here). */
export function panelSession(): string {
  return `panel:${workspaceRoots()[0] ?? 'none'}`;
}
