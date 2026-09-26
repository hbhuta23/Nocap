// nocap VS Code extension entry point. Owner: Role A (panel/ is Role B).
import * as vscode from 'vscode';
import { DaemonManager } from './daemonManager';
import { StatusBar } from './statusBar';
import { StreamClient } from './streamClient';
import { enableShims, disableShims } from './pathInjection';
import { installHooks, uninstallHooks, hooksInstalled } from './hookInstaller';
import { askHumanIntent } from './human/intentPrompt';
import { notifyOnBlock } from './notifications';
import { PanelProvider } from './panel/PanelProvider';
import { daemon } from './daemonClient';

export async function activate(context: vscode.ExtensionContext) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const statusBar = new StatusBar();
  const daemonManager = new DaemonManager(context, statusBar, workspaceRoot);
  const stream = new StreamClient();
  const panel = new PanelProvider(context.extensionUri, stream);

  context.subscriptions.push(
    statusBar,
    daemonManager,
    stream,
    vscode.window.registerWebviewViewProvider('nocap.panel', panel),

    stream.onEvent((e) => {
      if (e.type === 'human.needed') void askHumanIntent(e);
      if (e.type === 'check.finished') notifyOnBlock(e);
    }),

    vscode.commands.registerCommand('nocap.enable', async () => {
      if (!workspaceRoot) return vscode.window.showErrorMessage('nocap: open a folder first.');
      await installHooks(context, workspaceRoot);
      enableShims(context);
      // TODO(A9): copy a default .nocap.yml into the workspace if missing.
      vscode.window.showInformationMessage('nocap is on. Relaunch open terminals so shims apply.');
    }),
    vscode.commands.registerCommand('nocap.disable', async () => {
      if (workspaceRoot) await uninstallHooks(workspaceRoot);
      disableShims(context);
      vscode.window.showInformationMessage('nocap is off for this workspace.');
    }),
    vscode.commands.registerCommand('nocap.setTask', async () => {
      const task = await vscode.window.showInputBox({ prompt: 'What are you asking the agent to do?' });
      // TODO: shims use session "term-<pid>"; decide how panel tasks map to terminal sessions.
      if (task) await daemon.post('/v1/task', { session_id: 'panel', task, source: 'panel' });
    }),
    vscode.commands.registerCommand('nocap.openPanel', () => vscode.commands.executeCommand('workbench.view.extension.nocap')),
    vscode.commands.registerCommand('nocap.relaunchTerminals', () => {
      // TODO(A8): don't kill terminals with a running agent; offer to open a fresh one instead.
      vscode.window.createTerminal('nocap').show();
    }),
  );

  await daemonManager.start();
  stream.connect();

  // A3: make sure our hooks are still there on startup.
  if (workspaceRoot && (await hooksInstalled(workspaceRoot))) await installHooks(context, workspaceRoot);
}

export function deactivate() {}
