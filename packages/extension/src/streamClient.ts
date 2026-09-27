// WS /v1/stream client with auto-reconnect. Feeds the pop-up, notifications, and the panel.
import * as vscode from 'vscode';
import WebSocket from 'ws';
import type { StreamEvent } from '@nocap/shared';
import { daemon } from './daemonClient';
import { eventIsMine, workspaceRoots } from './workspace';

export class StreamClient implements vscode.Disposable {
  private ws: WebSocket | null = null;
  private emitter = new vscode.EventEmitter<StreamEvent>();
  private disposed = false;
  readonly onEvent = this.emitter.event;

  connect() {
    if (this.disposed) return;
    // Tell the daemon which folders this window has, so their pop-ups come here (see workspace.ts).
    const roots = encodeURIComponent(JSON.stringify(workspaceRoots()));
    this.ws = new WebSocket(daemon.base.replace('http', 'ws') + `/v1/stream?roots=${roots}`);
    // Only this workspace's events: pop-ups, notifications and the panel all read from here.
    this.ws.on('message', (data) => {
      const e = JSON.parse(data.toString()) as StreamEvent;
      if (eventIsMine(e)) this.emitter.fire(e);
    });
    this.ws.on('close', () => setTimeout(() => this.connect(), 2_000));
    this.ws.on('error', () => {}); // 'close' follows and handles the retry
  }

  /** Folders added or removed: reconnect so the daemon knows this window's new set ('close' reconnects). */
  private folders = vscode.workspace.onDidChangeWorkspaceFolders(() => this.ws?.close());

  dispose() {
    this.folders.dispose();
    this.disposed = true;
    this.ws?.close();
    this.emitter.dispose();
  }
}
