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
import { getApiKey, promptForApiKey, sendKeyToDaemon, welcome } from './onboarding';

const noFolder = () => vscode.window.showErrorMessage('nocap: open a folder first.');

export async function activate(context: vscode.ExtensionContext) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const statusBar = new StatusBar();
  const daemonManager = new DaemonManager(context, statusBar, workspaceRoot);
  const stream = new StreamClient();
  const panel = new PanelProvider(context.extensionUri, stream, workspaceRoot);

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
      if (!workspaceRoot) return noFolder();
      await context.workspaceState.update(DISABLED, false);
      await protect(true);
    }),
    vscode.commands.registerCommand('nocap.disable', async () => {
      if (workspaceRoot) await uninstallHooks(workspaceRoot);
      disableShims(context);
      await context.workspaceState.update(DISABLED, true); // stays off here, even with auto-protect
      vscode.window.showInformationMessage('nocap is off for this workspace. Run "nocap: Enable in this workspace" to turn it back on.');
    }),
    vscode.commands.registerCommand('nocap.setApiKey', async () => {
      if (await promptForApiKey(context)) {
        statusBar.setNeedsKey(false);
        vscode.window.showInformationMessage('nocap: key saved. The judge is on.');
      }
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

  // The judge's key comes from SecretStorage. A daemon started by another window gets it over localhost.
  const key = await getApiKey(context);
  await daemonManager.start(key ? { GEMINI_API_KEY: key } : {});
  if (key) await sendKeyToDaemon(key);
  stream.connect();
  statusBar.setNeedsKey(!key);

  if (process.platform === 'win32') {
    if (!context.globalState.get('nocap.windowsNotice')) {
      await context.globalState.update('nocap.windowsNotice', true);
      vscode.window.showWarningMessage('nocap runs on macOS and Linux for now. Windows support is on the way.');
    }
    return;
  }

  // Protect every workspace automatically (setting nocap.autoProtect), unless it was turned off here.
  // This also refreshes hook paths after an extension update (A3).
  const autoProtect = vscode.workspace.getConfiguration('nocap').get<boolean>('autoProtect', true);
  if (workspaceRoot && autoProtect && !context.workspaceState.get<boolean>(DISABLED)) await protect(false);
  else if (workspaceRoot && (await hooksInstalled(workspaceRoot))) await installHooks(context, workspaceRoot);

  // Chat hooks need a recent VS Code (1.108 has none). Detect the feature itself, not a version number:
  // the chat.useHooks setting only exists where chat hooks do. Cursor has its own hooks, so it's skipped.
  const chatHooks = vscode.workspace.getConfiguration('chat').inspect('useHooks');
  const isCursor = vscode.env.appName.toLowerCase().includes('cursor');
  if (!isCursor && chatHooks?.defaultValue === undefined && !context.globalState.get<boolean>('nocap.oldVsCodeNotice')) {
    await context.globalState.update('nocap.oldVsCodeNotice', true);
    vscode.window
      .showWarningMessage(
        `nocap: this VS Code (${vscode.version}) can't send chat actions to nocap yet. Commands the chat runs are still checked, but its file edits aren't. Update VS Code to protect those too.`,
        'Check for updates',
      )
      .then((c) => {
        if (c) void vscode.commands.executeCommand('update.checkForUpdate');
      });
  }

  // First run: welcome → API key.
  if (!key && !context.globalState.get<boolean>('nocap.welcomed')) {
    await context.globalState.update('nocap.welcomed', true);
    if (await welcome(context)) {
      statusBar.setNeedsKey(false);
      vscode.window.showInformationMessage("nocap is on. Your agents' risky actions will be checked before they run.", 'Open panel').then((c) => {
        if (c) void vscode.commands.executeCommand('nocap.openPanel');
      });
    }
  }

  /** Install hooks for every agent on this machine + the terminal shims. `announce` = always say what happened. */
  async function protect(announce: boolean) {
    if (!workspaceRoot) return;
    const agents = await installHooks(context, workspaceRoot);
    enableShims(context);
    const firstTime = !context.workspaceState.get<boolean>(ANNOUNCED);
    if (!announce && !firstTime) return;
    await context.workspaceState.update(ANNOUNCED, true);
    const codexNote = agents.includes('Codex') ? ' In Codex, run /hooks once to trust them.' : '';
    vscode.window
      .showInformationMessage(
        `nocap is protecting ${agents.join(', ')} and any agent in the terminal. Restart agents that were already running.${codexNote}`,
        'Open panel',
      )
      .then((c) => {
        if (c) void vscode.commands.executeCommand('nocap.openPanel');
      });
  }
}

const DISABLED = 'nocap.disabledHere';
const ANNOUNCED = 'nocap.announcedHere';

export function deactivate() {}
