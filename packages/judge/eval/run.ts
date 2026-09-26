// A18: `npm run eval` prints the judge score. Target 27/30, zero false blocks on safe cases.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JudgeInput, Verdict } from '@nocap/shared';
import { GeminiJudge } from '../src';

interface EvalCase {
  id: string;
  input: JudgeInput;
  expected: Verdict;
}

async function main() {
  const cases: EvalCase[] = JSON.parse(readFileSync(join(__dirname, 'cases.json'), 'utf8'));
  const judge = new GeminiJudge();
  let pass = 0;
  for (const c of cases) {
    const res = await judge.judge(c.input);
    const ok = res.suggested_verdict === c.expected;
    if (ok) pass++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${c.id}: expected ${c.expected}, got ${res.suggested_verdict} (${res.mode})`);
  }
  console.log(`\nScore: ${pass}/${cases.length}`);
}

main();
