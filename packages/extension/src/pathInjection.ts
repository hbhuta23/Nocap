// A8: put the shims first on PATH, only inside VS Code terminals.
import * as vscode from 'vscode';
import { delimiter } from 'node:path';

export function enableShims(context: vscode.ExtensionContext) {
  const env = context.environmentVariableCollection;
  env.description = 'nocap: routes risky agent commands through safety checks';
  env.prepend('PATH', context.asAbsolutePath('dist/shims/bin') + delimiter);
}

export function disableShims(context: vscode.ExtensionContext) {
  context.environmentVariableCollection.clear();
}
