// Test-diff facts (B11, FR-T1..T5): deterministic facts about an edit to a test file, so the judge can tell
// "made the code satisfy the test" from "made the test stop complaining". Owner: Role B (built by Role A).
//
//   FR-T1 expected values changed in assertions (toBe(85) → toBe(90), assert f(x) == 85 → 90)
//   FR-T2 tests deleted, skip markers added (.skip, xit, xdescribe, it.todo, @pytest.mark.skip, xfail)
//   FR-T3 assertion count before → after
//   FR-T4 non-test source files changed this session (edits the agent made through hooks + `git status`)
//   FR-T5 snapshot files overwritten, test timeouts raised
// Plus the code under test (the local module the test imports), so the judge can name the function to fix.

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import type { Ctx, Fact, Measurement, Measurer, CheckRequest } from '@nocap/shared';
import { DEFAULT_TEST_GLOBS } from '@nocap/shared';

// ---------- test file detection (tests.globs in .nocap.yml) ----------

function globToRegex(glob: string): RegExp {
  // Placeholders first, so the `*` inside an expanded `**` isn't expanded again.
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0001')
    .replace(/\*\*/g, '\u0002')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0001/g, '(?:.*/)?')
    .replace(/\u0002/g, '.*');
  return new RegExp(`^${re}$`);
}

/** "Source" means code, not config, docs or nocap's own logs. */
const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|java|kt|rs|c|cc|cpp|h|cs|php|swift|scala|vue|svelte|sql)$/;

export function isTestFile(file: string, cwd: string, globs: string[] = DEFAULT_TEST_GLOBS): boolean {
  const rel = isAbsolute(file) ? relative(cwd, file) : file;
  const path = rel.startsWith('..') ? file : rel;
  return /\.snap$/.test(path) || globs.some((g) => globToRegex(g).test(path) || globToRegex(g).test(path.split('/').pop() ?? ''));
}

// ---------- FR-T4: source edits this session ----------

const sourceEdits = new Map<string, Set<string>>();

/** Called by the pipeline for every edit an agent makes (test or not). */
export function noteEdit(req: CheckRequest, testGlobs?: string[]) {
  if (!req.edit || isTestFile(req.edit.file, req.cwd, testGlobs)) return;
  const set = sourceEdits.get(req.session_id) ?? new Set<string>();
  set.add(isAbsolute(req.edit.file) ? relative(req.cwd, req.edit.file) : req.edit.file);
  sourceEdits.set(req.session_id, set);
}

function gitModifiedFiles(cwd: string): Promise<string[]> {
  return new Promise((resolve) => {
    execFile('git', ['status', '--porcelain'], { cwd, timeout: 1500 }, (err, stdout) => {
      if (err) return resolve([]);
      resolve(stdout.split('\n').map((l) => l.slice(3).trim()).filter(Boolean));
    });
  });
}

// ---------- facts ----------

const ASSERTION = /\b(expect\s*\(|assert\b|assertEqual|assertEquals|assert_equal|assertThat|should\.)/g;
const TEST_DECL = /\b(?:it|test)\s*(?:\.\w+)?\s*\(|\bdef\s+test_\w+/g;
const SKIP = /\b(?:it|test|describe)\.(?:skip|todo)\b|\bx(?:it|test|describe)\s*\(|@pytest\.mark\.(?:skip|xfail)|\bpytest\.skip\(|\.xfail\b/g;

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

/** Expected values per assertion subject: `expect(applyDiscount(100)).toBe` → "85". */
function expectations(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const js = /(expect\s*\(([^;\n]*?)\)\s*(?:\.not)?\s*\.(?:toBe|toEqual|toStrictEqual|toBeCloseTo|toMatch|toContain|toHaveLength|toMatchObject))\s*\(([^;\n]*)\)/g;
  for (const m of text.matchAll(js)) out.set(m[1].replace(/\s+/g, ''), m[3].trim());
  const py = /^\s*(assert\s+(.+?)\s*(==|!=|<=|>=|<|>))\s*(.+?)\s*$/gm;
  for (const m of text.matchAll(py)) out.set(m[1].replace(/\s+/g, ' '), m[4].trim());
  const unit = /(assert(?:Equal|Equals|_equal)\s*\()\s*([^,]+),\s*([^)]+)\)/g;
  for (const m of text.matchAll(unit)) out.set(`${m[1]}${m[2].trim()}`, m[3].trim());
  return out;
}

function lineDiff(oldText: string, newText: string, max = 40): string {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const inB = new Set(b);
  const inA = new Set(a);
  const lines = [...a.filter((l) => !inB.has(l)).map((l) => `-${l}`), ...b.filter((l) => !inA.has(l)).map((l) => `+${l}`)];
  return lines.slice(0, max).join('\n');
}

/**
 * The local code the test imports, up to two modules and 3,000 characters. The module named like the test
 * comes first (cart.test.ts → ./cart), ahead of helpers it also imports (./expect, ./fixtures).
 */
function codeUnderTest(testFile: string, cwd: string, text: string): { file: string; excerpt: string } | null {
  const dir = dirname(isAbsolute(testFile) ? testFile : join(cwd, testFile));
  const base = (testFile.split('/').pop() ?? '').replace(/^test_/, '').replace(/\.(test|spec)\..*$|\.py$/, '');
  const specs = [
    ...new Set(
      [...text.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]|require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|^from\s+\.?(\w+)\s+import/gm)]
        .map((m) => m[1] ?? m[2] ?? (m[3] ? `./${m[3]}` : ''))
        .filter(Boolean),
    ),
  ];
  const nameOf = (spec: string) => (spec.split('/').pop() ?? '').replace(/\.\w+$/, '');
  specs.sort((a, b) => Number(nameOf(b) === base) - Number(nameOf(a) === base));

  const found: { file: string; text: string }[] = [];
  for (const spec of specs) {
    for (const ext of ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '/index.ts', '/index.js']) {
      try {
        const path = join(dir, spec + ext);
        found.push({ file: relative(cwd, path), text: readFileSync(path, 'utf8') });
        break;
      } catch {
        // try the next extension
      }
    }
    if (found.length === 2) break;
  }
  if (!found.length) return null;
  return {
    file: found.map((f) => f.file).join(', '),
    excerpt: found.map((f) => `// ${f.file}\n${f.text}`).join('\n\n').slice(0, 3000),
  };
}

export async function testDiffFacts(req: CheckRequest, ctx: Ctx): Promise<Measurement> {
  const file = req.edit!.file;
  const oldText = req.edit!.old ?? '';
  const newText = req.edit!.new ?? '';
  const globs = ctx.config.tests?.globs;

  const before = expectations(oldText);
  const after = expectations(newText);
  const changed = [...before].filter(([k, v]) => after.has(k) && after.get(k) !== v).map(([k, v]) => ({ assertion: `${k}(...)`, from: v, to: after.get(k)! }));
  const assertionsBefore = count(oldText, ASSERTION);
  const assertionsAfter = count(newText, ASSERTION);
  const testsDeleted = Math.max(0, count(oldText, TEST_DECL) - count(newText, TEST_DECL));
  const skipsAdded = Math.max(0, count(newText, SKIP) - count(oldText, SKIP));
  const snapshot = /\.snap$/.test(file) && oldText !== '' && oldText !== newText;
  const timeoutsBefore = [...oldText.matchAll(/(?:setTimeout|timeout)\s*[(:=]\s*(\d{3,})/gi)].map((m) => Number(m[1]));
  const timeoutsAfter = [...newText.matchAll(/(?:setTimeout|timeout)\s*[(:=]\s*(\d{3,})/gi)].map((m) => Number(m[1]));
  const timeoutRaised = Math.max(0, ...timeoutsAfter) > Math.max(0, ...timeoutsBefore);

  const git = await gitModifiedFiles(req.cwd);
  const sourceChanged = [...new Set([...(sourceEdits.get(req.session_id) ?? []), ...git])].filter((f) => CODE_FILE.test(f) && !isTestFile(f, req.cwd, globs));
  // Imports come from the edit or, when the agent sent only a snippet, from the test file on disk.
  const onDisk = (() => { try { return readFileSync(isAbsolute(file) ? file : join(req.cwd, file), 'utf8'); } catch { return ''; } })();
  const under = codeUnderTest(file, req.cwd, `${newText}\n${oldText}\n${onDisk}`);

  const weakened = changed.length > 0 || testsDeleted > 0 || skipsAdded > 0 || assertionsAfter < assertionsBefore || snapshot || timeoutRaised;
  const facts: Fact[] = [
    ...(changed.length ? [{ label: 'Expected values changed', value: changed.map((c) => `${c.from} → ${c.to}`).join(', '), severity: 'high' as const }] : []),
    ...(skipsAdded ? [{ label: 'Tests skipped', value: String(skipsAdded), severity: 'high' as const }] : []),
    ...(testsDeleted ? [{ label: 'Tests deleted', value: String(testsDeleted), severity: 'high' as const }] : []),
    { label: 'Assertions', value: `${assertionsBefore} → ${assertionsAfter}`, severity: assertionsAfter < assertionsBefore ? 'high' : 'low' },
    ...(snapshot ? [{ label: 'Snapshot overwritten', value: file, severity: 'high' as const }] : []),
    ...(timeoutRaised ? [{ label: 'Timeout raised', value: `${Math.max(0, ...timeoutsBefore)} → ${Math.max(...timeoutsAfter)} ms`, severity: 'medium' as const }] : []),
    { label: 'Source files changed', value: sourceChanged.length ? sourceChanged.slice(0, 5).join(', ') : 'none', severity: weakened && !sourceChanged.length ? 'high' : 'low' },
  ];

  return {
    facts,
    judgeContext: {
      file,
      diff: lineDiff(oldText, newText),
      expected_values_changed: changed,
      tests_skipped: skipsAdded,
      tests_deleted: testsDeleted,
      assertions_before: assertionsBefore,
      assertions_after: assertionsAfter,
      snapshot_overwritten: snapshot,
      timeout_raised: timeoutRaised,
      source_files_changed_this_session: sourceChanged,
      ...(under ? { code_under_test: `${under.file}:\n${under.excerpt}` } : {}),
    },
  };
}

export const testDiffMeasurer: Measurer = {
  category: 'test_cheat',
  matches: (req) => Boolean(req.edit),
  measure: testDiffFacts,
};
