// nocap VS Code extension entry point. Owner: Role A (panel/ is Role B).
import * as vscode from 'vscode';
import { DaemonManager } from './daemonManager';
import { StatusBar } from './statusBar';
import { StreamClient } from './streamClient';
import { enableShims, disableShims } from './pathInjection';
import { installHooks, uninstallHooks, hooksInstalled } from './hookInstaller';
import { enqueueHumanIntent, onHumanAnswered } from './human/intentPrompt';
import { notifyOnBlock } from './notifications';
import { PanelProvider } from './panel/PanelProvider';
import { daemon } from './daemonClient';
import { manageRules, promptAddRule, readRules } from './rules';

const noFolder = () => vscode.window.showErrorMessage('nocap: open a folder first.');

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
      if (e.type === 'human.needed') enqueueHumanIntent(e);
      if (e.type === 'human.answered') onHumanAnswered(e.check_id, e.outcome);
      if (e.type === 'check.finished') notifyOnBlock(e);
    }),

    vscode.commands.registerCommand('nocap.enable', async () => {
      if (!workspaceRoot) return vscode.window.showErrorMessage('nocap: open a folder first.');
      const agents = await installHooks(context, workspaceRoot);
      enableShims(context);
      // TODO(A9): copy a default .nocap.yml into the workspace if missing.
      const codexNote = agents.includes('Codex') ? ' In Codex, run /hooks once to trust the new hooks.' : '';
      vscode.window.showInformationMessage(
        `nocap is on for ${agents.join(', ')}, plus any other agent through the terminal shims. Relaunch open terminals and restart running agents.${codexNote}`,
      );
    }),
    vscode.commands.registerCommand('nocap.disable', async () => {
      if (workspaceRoot) await uninstallHooks(workspaceRoot);
      disableShims(context);
      vscode.window.showInformationMessage('nocap is off for this workspace.');
    }),
    vscode.commands.registerCommand('nocap.setTask', async (providedTask?: string) => {
      const task = providedTask ?? await vscode.window.showInputBox({ prompt: 'What are you asking the agent to do?' });
      // TODO: shims use session "term-<pid>"; decide how panel tasks map to terminal sessions.
      if (task) await daemon.post('/v1/task', { session_id: 'panel', task, source: 'panel' });
    }),
    vscode.commands.registerCommand('nocap.openPanel', () => vscode.commands.executeCommand('workbench.view.extension.nocap')),
    vscode.commands.registerCommand('nocap.addRule', () => (workspaceRoot ? promptAddRule(workspaceRoot) : noFolder())),
    vscode.commands.registerCommand('nocap.manageRules', () => (workspaceRoot ? manageRules(workspaceRoot) : noFolder())),
    // The shield icon in the editor title bar (next to Claude's) opens this menu.
    vscode.commands.registerCommand('nocap.menu', async () => {
      if (!workspaceRoot) return noFolder();
      const rules = await readRules(workspaceRoot);
      const items = [
        { label: `$(law) Team rules (${rules.length})`, detail: rules.length ? rules.slice(0, 3).join(' · ') : 'Standards the AI must never break', command: 'nocap.manageRules' },
        { label: '$(add) Add a team rule', command: 'nocap.addRule' },
        { label: '$(shield) Open the nocap panel', command: 'nocap.openPanel' },
        { label: "$(edit) Set the agent's task", command: 'nocap.setTask' },
      ];
      const picked = await vscode.window.showQuickPick(items, { title: 'nocap' });
      if (picked) await vscode.commands.executeCommand(picked.command);
    }),
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
