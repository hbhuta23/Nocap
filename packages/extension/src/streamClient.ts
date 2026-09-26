// WS /v1/stream client with auto-reconnect. Feeds the pop-up, notifications, and the panel.
import * as vscode from 'vscode';
import WebSocket from 'ws';
import type { StreamEvent } from '@nocap/shared';
import { daemon } from './daemonClient';

export class StreamClient implements vscode.Disposable {
  private ws: WebSocket | null = null;
  private emitter = new vscode.EventEmitter<StreamEvent>();
  private disposed = false;
  readonly onEvent = this.emitter.event;

  connect() {
    if (this.disposed) return;
    this.ws = new WebSocket(daemon.base.replace('http', 'ws') + '/v1/stream');
    this.ws.on('message', (data) => this.emitter.fire(JSON.parse(data.toString())));
    this.ws.on('close', () => setTimeout(() => this.connect(), 2_000));
    this.ws.on('error', () => {}); // 'close' follows and handles the retry
  }

  dispose() {
    this.disposed = true;
    this.ws?.close();
    this.emitter.dispose();
  }
}
