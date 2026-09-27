// First run: install from the Marketplace → asked for an API key (Gemini, Anthropic, OpenAI, …) → every workspace
// protected automatically. The key lives in VS Code SecretStorage (the OS keychain), never in a file, and is handed to the daemon.
import * as vscode from 'vscode';
import { detectProvider } from '@nocap/shared';
import { daemon } from './daemonClient';

// The secret's id predates multi-provider support; kept so saved keys still load.
const KEY_SECRET = 'nocap.geminiApiKey';
/** Gemini has a free tier, so it's the key we point new users to. */
const KEY_URL = 'https://aistudio.google.com/apikey';
const PROVIDER_LIST = 'Gemini, Anthropic, OpenAI, OpenRouter, Groq or xAI';

export async function getApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  return context.secrets.get(KEY_SECRET);
}

/** The daemon asks the provider (a real request), so a typo'd or revoked key is caught before it's saved. */
async function checkKey(key: string): Promise<{ ok: boolean; provider?: string; error?: string }> {
  try {
    return await daemon.post('/v1/key/check', { api_key: key });
  } catch {
    // Daemon unreachable: accept any key whose provider we recognise; the judge will report a bad one later.
    const provider = detectProvider(key);
    return provider ? { ok: true, provider: provider.name } : { ok: false, error: `Use a key from ${PROVIDER_LIST}.` };
  }
}

/** Ask for the key, check it, store it, and give it to the running daemon. Returns true when saved. */
export async function promptForApiKey(context: vscode.ExtensionContext): Promise<boolean> {
  const key = await vscode.window.showInputBox({
    title: 'Nocap: AI API key',
    prompt: `Nocap's judge compares what the agent says with what a command really does. Paste a key from ${PROVIDER_LIST}. Gemini has a free tier: ${KEY_URL}`,
    placeHolder: 'Paste your key',
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim().length < 20 ? 'That looks too short for an API key.' : null),
  });
  if (!key) return false;

  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Nocap: checking your key…' },
    () => checkKey(key.trim()),
  );
  if (!result.ok) {
    const who = result.provider ? `${result.provider} rejected that key (or couldn't be reached).` : result.error ?? 'That key was rejected.';
    const again = await vscode.window.showErrorMessage(`Nocap: ${who}`, 'Try again', 'Get a free Gemini key');
    if (again === 'Get a free Gemini key') void vscode.env.openExternal(vscode.Uri.parse(KEY_URL));
    return again === 'Try again' ? promptForApiKey(context) : false;
  }

  await context.secrets.store(KEY_SECRET, key.trim());
  await sendKeyToDaemon(key.trim());
  vscode.window.showInformationMessage(`Nocap: using ${result.provider ?? 'your key'} for the judge.`);
  return true;
}

export async function sendKeyToDaemon(key: string) {
  await daemon.post('/v1/key', { api_key: key }).catch(() => undefined);
}

/** First activation without a key: a welcome that leads straight to the key prompt. */
export async function welcome(context: vscode.ExtensionContext): Promise<boolean> {
  const choice = await vscode.window.showInformationMessage(
    `Welcome to Nocap. It checks what your AI agents are about to do before they do it, in the chat and in the terminal. Add an API key (${PROVIDER_LIST}) to turn it on.`,
    'Add API key',
    'Get a free Gemini key',
    'Later',
  );
  if (choice === 'Get a free Gemini key') {
    void vscode.env.openExternal(vscode.Uri.parse(KEY_URL));
    return promptForApiKey(context);
  }
  if (choice === 'Add API key') return promptForApiKey(context);
  return false;
}
