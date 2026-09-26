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
    const messages = view.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'set-task' && typeof message.task === 'string' && message.task.trim()) {
        await vscode.commands.executeCommand('nocap.setTask', message.task.trim());
      }
    });
    view.onDidDispose(() => sub.dispose());
    view.onDidDispose(() => messages.dispose());
  }
}

function html() {
  return /* html */ `<!doctype html><html><head><meta charset="UTF-8"><style>
    :root { color-scheme: light dark; } * { box-sizing: border-box; }
    body { margin: 0; padding: 12px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-sideBar-background); }
    h1 { font-size: 18px; margin: 0; letter-spacing: .04em; } h2 { font-size: 12px; text-transform: uppercase; margin: 18px 0 8px; color: var(--vscode-descriptionForeground); }
    .top { display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 10px; }
    .status { color: var(--vscode-testing-iconPassed); font-size: 11px; } .task { border: 1px solid var(--vscode-panel-border); padding: 10px; background: var(--vscode-editor-background); }
    .task p { margin: 4px 0 0; line-height: 1.35; } button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; padding: 5px 9px; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); } input { width:100%; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 6px; }
    .empty { color: var(--vscode-descriptionForeground); font-size: 12px; } .event { border-left: 3px solid var(--vscode-testing-iconPassed); padding: 7px 8px; margin: 6px 0; background: var(--vscode-editor-background); }
    .event.block { border-color: var(--vscode-testing-iconFailed); } .event.warn, .event.ask { border-color: var(--vscode-editorWarning-foreground); }
    .verdict { font-weight: 700; font-size: 11px; text-transform: uppercase; } .command { overflow-wrap:anywhere; margin-top: 3px; font-family: var(--vscode-editor-font-family); font-size: 11px; }
    .cap { border: 1px solid var(--vscode-testing-iconFailed); padding: 10px; margin-top: 12px; background: color-mix(in srgb, var(--vscode-testing-iconFailed) 12%, transparent); } .cap h3 { margin:0 0 8px; color: var(--vscode-testing-iconFailed); }
    .fact { display:flex; justify-content:space-between; gap:8px; padding: 3px 0; } .high { color: var(--vscode-testing-iconFailed); font-weight:700; }
  </style></head><body>
    <div class="top"><h1>nocap</h1><span class="status">● ON</span></div>
    <h2>Current task</h2><section class="task"><p id="task" class="empty">No task set</p><div style="display:flex;gap:6px;margin-top:8px"><input id="taskInput" placeholder="Set the agent's task"><button id="taskButton">Set</button></div></section>
    <div id="cap"></div><h2>Live activity</h2><section id="feed"><p class="empty">No actions checked yet.</p></section>
    <script>
      const api = acquireVsCodeApi(); const feed = document.getElementById('feed'); const cap = document.getElementById('cap');
      document.getElementById('taskButton').onclick = () => { const input = document.getElementById('taskInput'); api.postMessage({ type:'set-task', task: input.value }); input.value=''; };
      function addEvent(e) { if (feed.querySelector('.empty')) feed.innerHTML=''; const r=e.response; const row=document.createElement('article'); row.className='event '+r.verdict; const v=document.createElement('div'); v.className='verdict'; v.textContent=r.verdict; const c=document.createElement('div'); c.className='command'; c.textContent=e.request.command; row.append(v,c); feed.prepend(row); if (r.verdict==='block') showCap(r,e.request); }
      function showCap(r, request) { cap.innerHTML=''; const box=document.createElement('section'); box.className='cap'; const title=document.createElement('h3'); title.textContent='CAP DETECTED'; box.append(title); const summary=document.createElement('p'); summary.textContent=r.headline; box.append(summary); r.facts.forEach(f=>{ const line=document.createElement('div'); line.className='fact'; line.innerHTML='<span></span><strong></strong>'; line.firstChild.textContent=f.label; line.lastChild.textContent=f.value; if(f.severity==='high') line.lastChild.className='high'; box.append(line); }); const reason=document.createElement('p'); reason.textContent=r.reason_for_agent; box.append(reason); cap.append(box); }
      window.addEventListener('message', ({data:e}) => { if(e.type==='task.updated') { document.getElementById('task').textContent=e.task; document.getElementById('task').className=''; } if(e.type==='check.finished') addEvent(e); });
    </script></body></html>`;
}
