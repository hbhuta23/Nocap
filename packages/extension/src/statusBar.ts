import * as vscode from 'vscode';

export type NocapStatus = 'on' | 'off' | 'offline';

export class StatusBar implements vscode.Disposable {
  private item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

  constructor() {
    this.item.command = 'nocap.openPanel';
    this.set('off');
    this.item.show();
  }

  set(status: NocapStatus) {
    this.item.text = `$(shield) nocap: ${status}`;
    this.item.backgroundColor =
      status === 'offline' ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined;
  }

  dispose() {
    this.item.dispose();
  }
}
