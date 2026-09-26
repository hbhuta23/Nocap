// FR-G7 / A17: nothing sensitive reaches Gemini.
// Drops redacted columns (by key name, any depth) and masks secret-looking strings.

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI / Anthropic style
  /AKIA[0-9A-Z]{16}/g, // AWS access key
  /ghp_[A-Za-z0-9]{30,}/g, // GitHub token
  /AIza[0-9A-Za-z_-]{30,}/g, // Google API key
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // emails
];

export function redact<T>(value: T, redactColumns: string[]): T {
  const drop = new Set(redactColumns.map((c) => c.toLowerCase()));
  return walk(value, drop) as T;
}

function walk(v: unknown, drop: Set<string>): unknown {
  if (typeof v === 'string') return maskSecrets(v);
  if (Array.isArray(v)) return v.map((x) => walk(x, drop));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (drop.has(k.toLowerCase())) continue;
      out[k] = walk(val, drop);
    }
    return out;
  }
  return v;
}

function maskSecrets(s: string): string {
  return SECRET_PATTERNS.reduce((acc, re) => acc.replace(re, '[REDACTED]'), s);
}
