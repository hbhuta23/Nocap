// Side panel (B17–B20). Owner: Role B. Build from Role C's mockups.
// Placeholder: forwards every stream event into the webview so the panel can be built against real data.
import * as vscode from 'vscode';
import type { StreamClient } from '../streamClient';

export class PanelProvider implements vscode.WebviewViewProvider {
  constructor(
    private extensionUri: vscode.Uri,
    private stream: StreamClient,
  ) {}

  resolveWebviewView(view: vscode.WebviewView) {
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    view.webview.html = html();
    const sub = this.stream.onEvent((e) => view.webview.postMessage(e));
    view.onDidDispose(() => sub.dispose());
  }
}

function html() {
  // Use VS Code theme variables (var(--vscode-*)) so every theme works (C6).
  return /* html */ `<!doctype html>
<html><body style="font-family: var(--vscode-font-family); color: var(--vscode-foreground)">
  <h3>nocap</h3>
  <div id="task">No task set</div>
  <ul id="feed"></ul>
  <script>
    const feed = document.getElementById('feed');
    window.addEventListener('message', ({ data }) => {
      if (data.type === 'task.updated') document.getElementById('task').textContent = data.task;
      if (data.type === 'check.finished') {
        const li = document.createElement('li');
        li.textContent = data.response.verdict + ': ' + data.request.command;
        feed.prepend(li);
      }
    });
  </script>
</body></html>`;
}
