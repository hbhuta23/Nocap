// First run: install from the Marketplace → asked for a Gemini API key → every workspace protected automatically.
// The key lives in VS Code SecretStorage (the OS keychain), never in a file, and is handed to the daemon.
import * as vscode from 'vscode';
import { daemon } from './daemonClient';

const KEY_SECRET = 'nocap.geminiApiKey';
const KEY_URL = 'https://aistudio.google.com/apikey';

export async function getApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  return context.secrets.get(KEY_SECRET);
}

/** A real request, so a typo'd or revoked key is caught before it's saved. */
async function keyWorks(key: string): Promise<boolean> {
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
      headers: { 'x-goog-api-key': key },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Ask for the key, check it, store it, and give it to the running daemon. Returns true when saved. */
export async function promptForApiKey(context: vscode.ExtensionContext): Promise<boolean> {
  const key = await vscode.window.showInputBox({
    title: 'nocap: Gemini API key',
    prompt: `nocap's judge uses Gemini to compare what the agent says with what a command really does. Get a free key at ${KEY_URL}`,
    placeHolder: 'Paste your key',
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim().length < 20 ? 'That looks too short for an API key.' : null),
  });
  if (!key) return false;

  const ok = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'nocap: checking your key…' },
    () => keyWorks(key.trim()),
  );
  if (!ok) {
    const again = await vscode.window.showErrorMessage('nocap: Google rejected that key (or it could not be reached).', 'Try again', 'Get a key');
    if (again === 'Get a key') void vscode.env.openExternal(vscode.Uri.parse(KEY_URL));
    return again === 'Try again' ? promptForApiKey(context) : false;
  }

  await context.secrets.store(KEY_SECRET, key.trim());
  await sendKeyToDaemon(key.trim());
  return true;
}

export async function sendKeyToDaemon(key: string) {
  await daemon.post('/v1/key', { gemini_api_key: key }).catch(() => undefined);
}

/** First activation without a key: a welcome that leads straight to the key prompt. */
export async function welcome(context: vscode.ExtensionContext): Promise<boolean> {
  const choice = await vscode.window.showInformationMessage(
    'Welcome to nocap. It checks what your AI agents are about to do before they do it, in the chat and in the terminal. Add a Gemini API key to turn it on.',
    'Add API key',
    'Get a free key',
    'Later',
  );
  if (choice === 'Get a free key') {
    void vscode.env.openExternal(vscode.Uri.parse(KEY_URL));
    return promptForApiKey(context);
  }
  if (choice === 'Add API key') return promptForApiKey(context);
  return false;
}
