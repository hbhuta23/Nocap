// Side panel (B17–B20): status and stats, current task, CAP DETECTED view (Task / Agent says / Actually does),
// team rules, and the live feed. UI lives in media/panel.{js,css}; this file wires it to the daemon stream,
// the rules file, and extension commands. Restyle from Role C's mockups by editing panel.css.
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { daemon } from '../daemonClient';
import { addRule, promptAddRule, readRules, removeRule } from '../rules';
import type { StreamClient } from '../streamClient';

export class PanelProvider implements vscode.WebviewViewProvider {
  constructor(
    private extensionUri: vscode.Uri,
    private stream: StreamClient,
    private workspaceRoot: string | undefined,
  ) {}

  resolveWebviewView(view: vscode.WebviewView) {
    const webview = view.webview;
    webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')] };
    webview.html = this.html(webview);

    const post = (message: unknown) => void webview.postMessage(message);
    const sendRules = async () => post({ type: 'rules', rules: this.workspaceRoot ? await readRules(this.workspaceRoot) : [] });

    const disposables: vscode.Disposable[] = [
      this.stream.onEvent((e) => post(e)),
      webview.onDidReceiveMessage(async (m) => {
        const root = this.workspaceRoot;
        switch (m.type) {
          case 'ready':
            post({
              type: 'init',
              online: await daemon.healthy(),
              rules: root ? await readRules(root) : [],
              recent: await daemon.get('/v1/recent').catch(() => null),
            });
            break;
          case 'set-task':
            await vscode.commands.executeCommand('nocap.setTask', m.task);
            break;
          case 'add-rule':
            if (!root) break;
            if (typeof m.rule === 'string' && m.rule.trim()) await addRule(root, m.rule);
            else await promptAddRule(root);
            await sendRules();
            break;
          case 'remove-rule': {
            if (!root) break;
            const rules = await readRules(root);
            const rule = rules[m.index];
            if (rule === undefined) break;
            const ok = await vscode.window.showWarningMessage(`Remove the team rule "${rule}"?`, { modal: true }, 'Remove');
            if (ok === 'Remove') await removeRule(root, m.index);
            await sendRules();
            break;
          }
          case 'copy':
            await vscode.env.clipboard.writeText(String(m.text ?? ''));
            vscode.window.setStatusBarMessage('Nocap: copied', 2000);
            break;
        }
      }),
    ];

    // Keep the rules list in sync with .nocap.yml, including edits made by hand or by teammates via git.
    if (this.workspaceRoot) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.workspaceRoot, '.nocap.yml'));
      disposables.push(watcher, watcher.onDidChange(sendRules), watcher.onDidCreate(sendRules), watcher.onDidDelete(sendRules));
    }

    // Online/offline indicator.
    let lastOnline: boolean | undefined;
    const timer = setInterval(async () => {
      const online = await daemon.healthy();
      if (online !== lastOnline) post({ type: 'status', online });
      lastOnline = online;
    }, 3000);

    view.onDidDispose(() => {
      clearInterval(timer);
      disposables.forEach((d) => d.dispose());
    });
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const media = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', file));
    return /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${media('panel.css')}">
</head>
<body>
  <header class="top">
    <span class="brand"><img src="${media('logo.svg')}" alt="" width="20" height="20">Nocap</span>
    <span id="status" class="status">on</span>
  </header>
  <div class="stats">
    <div class="stat"><b id="stat-checked">0</b><span>risky actions checked</span></div>
    <div class="stat" id="stat-blocked-box"><b id="stat-blocked">0</b><span>blocked</span></div>
    <div class="stat"><b id="stat-blind">0</b><span>blind approvals prevented</span></div>
  </div>

  <h2>Current task</h2>
  <section class="card">
    <div id="task-text" class="task-text muted"></div>
    <div id="task-meta" class="task-meta muted"></div>
    <div class="row"><input id="task-input" placeholder="Set the agent's task"><button id="task-set" class="primary">Set</button></div>
  </section>

  <div id="cap"></div>

  <h2>Team rules <button id="rule-add" class="link">+ add</button></h2>
  <section class="card"><ul id="rules" class="rules"></ul></section>

  <h2>Live activity</h2>
  <section id="feed"></section>

  <script nonce="${nonce}" src="${media('panel.js')}"></script>
</body>
</html>`;
  }
}
