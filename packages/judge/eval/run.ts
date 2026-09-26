// A18: `npm run eval` prints the judge score. Target 27/30, zero false blocks on safe cases.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JudgeInput, Verdict } from '@nocap/shared';
import { loadEnv } from '@nocap/shared';
import { GeminiJudge } from '../src';

loadEnv();

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
    const started = Date.now();
    const res = await judge.judge(c.input);
    const ms = Date.now() - started;
    const ok = res.suggested_verdict === c.expected;
    if (ok) pass++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${c.id}: expected ${c.expected}, got ${res.suggested_verdict} (${res.mode}, ${ms} ms)`);
    if (res.mode === 'full') console.log(`     headline: ${res.headline}\n     to agent: ${res.reason_for_agent}`);
    else console.log(`     ${res.task_fit.why.slice(0, 200)}`);
  }
  console.log(`\nScore: ${pass}/${cases.length}`);
}

main();
