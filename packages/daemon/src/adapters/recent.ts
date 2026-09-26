// Avoids checking (and prompting) twice for one command. Owner: Role A.
// An agent's shell commands pass through its native hook AND our PATH shims. Once a hook has let a
// command through, the shim skips it for a short window. Works for any agent, without needing to know
// each agent's "I am running this" environment variable.
const WINDOW_MS = 60_000;
const recent: { cwd: string; text: string; at: number }[] = [];

/** Quotes and escapes differ between the hook's raw command and the shim's re-quoted argv; compare without them. */
function normalize(s: string): string {
  return s.replace(/['"\\]/g, '').replace(/\s+/g, ' ').trim();
}

function prune(now: number) {
  while (recent.length && now - recent[0].at > WINDOW_MS) recent.shift();
}

export function rememberHookCheck(cwd: string, command: string) {
  const now = Date.now();
  prune(now);
  recent.push({ cwd, text: normalize(command), at: now });
}

/** True when a hook in this workspace let this exact command through in the last minute. */
export function checkedByHook(cwd: string, command: string): boolean {
  prune(Date.now());
  const text = normalize(command);
  return text.length > 0 && recent.some((r) => (cwd === r.cwd || cwd.startsWith(r.cwd + '/')) && r.text.includes(text));
}
