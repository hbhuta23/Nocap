import * as vscode from 'vscode';

export type NocapStatus = 'on' | 'off' | 'offline';

export class StatusBar implements vscode.Disposable {
  private item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  private status: NocapStatus = 'off';
  private needsKey = false;

  constructor() {
    this.render();
    this.item.show();
  }

  set(status: NocapStatus) {
    this.status = status;
    this.render();
  }

  /** Without a Gemini key nocap still runs on rules and measurements; the status bar offers the key prompt. */
  setNeedsKey(needsKey: boolean) {
    this.needsKey = needsKey;
    this.render();
  }

  private render() {
    if (this.status === 'offline') {
      this.item.text = '$(shield) nocap: offline';
      this.item.tooltip = 'The nocap daemon is not running. Risky agent actions are blocked until it is back.';
      this.item.command = 'nocap.openPanel';
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      return;
    }
    this.item.backgroundColor = this.needsKey ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    this.item.text = this.needsKey ? '$(shield) nocap: add key' : `$(shield) nocap: ${this.status}`;
    this.item.tooltip = this.needsKey ? 'Add a Gemini API key to turn on the judge (rules and measurements work without it).' : 'Open the nocap panel';
    this.item.command = this.needsKey ? 'nocap.setApiKey' : 'nocap.openPanel';
  }

  dispose() {
    this.item.dispose();
  }
}
