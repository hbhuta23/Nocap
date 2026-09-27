// A8: put the shims first on PATH, only inside VS Code terminals.
import * as vscode from 'vscode';
import { delimiter, join } from 'node:path';
import { chmodSync, readdirSync } from 'node:fs';

export function enableShims(context: vscode.ExtensionContext) {
  ensureExecutable(context);
  const env = context.environmentVariableCollection;
  env.description = 'nocap: routes risky agent commands through safety checks';
  env.prepend('PATH', context.asAbsolutePath('dist/shims/bin') + delimiter);
}

export function disableShims(context: vscode.ExtensionContext) {
  context.environmentVariableCollection.clear();
}

/** A .vsix installed from the Marketplace can lose the execute bit; without it every shimmed command fails. */
function ensureExecutable(context: vscode.ExtensionContext) {
  for (const dir of ['dist/shims/bin', 'dist/shims/hooks']) {
    const abs = context.asAbsolutePath(dir);
    try {
      for (const f of readdirSync(abs)) chmodSync(join(abs, f), 0o755);
    } catch {
      // read-only install or missing folder: leave it; the files ship executable
    }
  }
}
