// A11: a warning toast with a View button on every block.
import * as vscode from 'vscode';
import type { StreamEvent } from '@nocap/shared';

export function notifyOnBlock(e: Extract<StreamEvent, { type: 'check.finished' }>) {
  if (e.response.verdict !== 'block') return;
  void vscode.window.showWarningMessage(e.response.headline, 'View').then((choice) => {
    if (choice === 'View') void vscode.commands.executeCommand('nocap.openPanel');
  });
}
