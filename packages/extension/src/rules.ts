// Team rules editor: plain-English standards the AI must not break, stored in the repo's .nocap.yml
// (`rules:` list) so the whole team shares them and changes are reviewed in git. Owner: Role A.
// The daemon re-reads .nocap.yml on every check, so edits apply immediately.
import * as vscode from 'vscode';
import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import YAML, { isSeq } from 'yaml';

const FILE = '.nocap.yml';

export const SUGGESTED_RULES = [
  'Never touch the payments table',
  "Don't change a test to make it pass; fix the code instead",
  'Ask before anything that costs more than $2',
  'Never force-push to main',
  'Never edit files in db/migrations',
];

async function load(root: string): Promise<YAML.Document> {
  const file = join(root, FILE);
  const text = existsSync(file) ? await fs.readFile(file, 'utf8') : '# Nocap rules for this repo\nversion: 1\n';
  return YAML.parseDocument(text);
}

async function save(root: string, doc: YAML.Document) {
  await fs.writeFile(join(root, FILE), doc.toString());
}

export async function readRules(root: string): Promise<string[]> {
  const rules = (await load(root)).toJS()?.rules;
  return Array.isArray(rules) ? rules.filter((r): r is string => typeof r === 'string') : [];
}

export async function addRule(root: string, rule: string) {
  const doc = await load(root);
  const seq = doc.get('rules');
  if (isSeq(seq)) seq.add(rule.trim());
  else doc.set('rules', doc.createNode([rule.trim()]));
  await save(root, doc);
}

export async function removeRule(root: string, index: number) {
  const doc = await load(root);
  const seq = doc.get('rules');
  if (isSeq(seq)) seq.items.splice(index, 1);
  await save(root, doc);
}

/** "Add a team rule": type your own, or pick a suggestion. */
export async function promptAddRule(root: string) {
  const existing = await readRules(root);
  const pick = vscode.window.createQuickPick();
  pick.title = 'Nocap: add a team rule';
  pick.placeholder = 'Type a rule the AI must never break, or pick a suggestion';
  const suggestions = SUGGESTED_RULES.filter((s) => !existing.includes(s)).map((label) => ({ label, description: 'suggestion' }));
  pick.items = suggestions;
  pick.onDidChangeValue((v) => {
    pick.items = v.trim() ? [{ label: v.trim(), description: 'add this rule' }, ...suggestions] : suggestions;
  });
  const chosen = await new Promise<string | undefined>((resolve) => {
    pick.onDidAccept(() => resolve(pick.selectedItems[0]?.label ?? (pick.value.trim() || undefined)));
    pick.onDidHide(() => resolve(undefined));
    pick.show();
  });
  pick.dispose();
  if (!chosen) return;
  await addRule(root, chosen);
  vscode.window.showInformationMessage(`Nocap: team rule added. Every agent action is now checked against "${chosen}".`);
}

/** "Team rules": list, remove, add, or open the file. */
export async function manageRules(root: string) {
  const rules = await readRules(root);
  type Item = vscode.QuickPickItem & { index?: number; action?: 'add' | 'open' };
  const items: Item[] = [
    ...rules.map((r, index) => ({ label: `$(law) ${r}`, description: 'select to remove', index })),
    { label: '$(add) Add a team rule', action: 'add' },
    { label: '$(go-to-file) Open .nocap.yml', action: 'open' },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: `Nocap: team rules (${rules.length})`,
    placeHolder: rules.length ? 'The AI is blocked from breaking any of these' : 'No rules yet. Add one the AI must never break',
  });
  if (!picked) return;
  if (picked.action === 'add') return promptAddRule(root);
  if (picked.action === 'open') return vscode.window.showTextDocument(vscode.Uri.file(join(root, FILE)));
  if (picked.index === undefined) return;
  const confirm = await vscode.window.showWarningMessage(`Remove the team rule "${rules[picked.index]}"?`, { modal: true }, 'Remove');
  if (confirm === 'Remove') await removeRule(root, picked.index);
}
