// A7: start the bundled daemon on workspace open, restart on crash (max 3), stop on close.
import * as vscode from 'vscode';
import { spawn, type ChildProcess } from 'node:child_process';
import { BUILD_ID, type HealthResponse } from '@nocap/shared';
import { daemon } from './daemonClient';
import type { StatusBar } from './statusBar';

const MAX_RESTARTS = 3;

export class DaemonManager implements vscode.Disposable {
  private proc: ChildProcess | null = null;
  private restarts = 0;
  private disposed = false;
  private healthTimer: NodeJS.Timeout | undefined;

  constructor(
    private context: vscode.ExtensionContext,
    private statusBar: StatusBar,
    private workspaceRoot: string | undefined,
  ) {}

  private env: Record<string, string> = {};

  /** `env` is added to the daemon's environment (the API key from SecretStorage). */
  async start(env: Record<string, string> = {}) {
    this.env = env;
    // A daemon may already be running: another window (reuse it), `npm run dev:daemon` (build "dev", reuse it),
    // or one left over from an older build after an update or F5 (replace it, or old code keeps answering).
    if (await daemon.healthy()) {
      const health = await daemon.get<HealthResponse>('/v1/health').catch(() => null);
      if (health && health.build !== BUILD_ID && health.build !== 'dev') {
        await daemon.post('/v1/shutdown', {}).catch(() => undefined);
        for (let i = 0; i < 20 && (await daemon.healthy()); i++) await new Promise((r) => setTimeout(r, 100));
        this.spawn();
      }
    } else {
      this.spawn();
    }
    this.healthTimer = setInterval(async () => this.statusBar.set((await daemon.healthy()) ? 'on' : 'offline'), 2_000);
  }

  private spawn() {
    const script = this.context.asAbsolutePath('dist/daemon.js');
    // Run with VS Code's own Node (Electron in node mode), so users don't need Node installed.
    this.proc = spawn(process.execPath, [script], {
      cwd: this.workspaceRoot,
      env: { ...process.env, ...this.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'ignore',
    });
    this.proc.on('exit', () => {
      this.proc = null;
      if (this.disposed) return;
      if (this.restarts++ < MAX_RESTARTS) this.spawn();
      else this.statusBar.set('offline');
    });
  }

  dispose() {
    this.disposed = true;
    clearInterval(this.healthTimer);
    this.proc?.kill();
  }
}
