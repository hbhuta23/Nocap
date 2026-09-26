import { randomUUID } from 'node:crypto';
import { GeminiJudge } from '@nocap/judge';
import type { CheckRequest, JudgeResult, VerdictResponse } from '@nocap/shared';
import { bus } from './bus';
import { audit } from './audit';
import { classify } from './classifier';
import { loadConfig } from './config';
import { holdForHuman } from './humanCheck';
import { measurers } from './measurers';
import { applyPolicy } from './policy';
import { sessions } from './sessions';

const judge = new GeminiJudge();

export async function runCheck(req: CheckRequest): Promise<VerdictResponse> {
  const started = Date.now();
  const check_id = `chk_${randomUUID()}`;
  bus.emit({ type: 'check.started', check_id, request: req, at: started });
  const category = classify(req);
  const config = loadConfig(req.cwd);
  const task = sessions.getTask(req.session_id) ?? sessions.getTask('panel');
  let response: VerdictResponse = { check_id, verdict: 'allow', category, headline: 'Allowed', facts: [], layers: { task_fit: { ok: true, why: 'Safe command; no deep check needed.' }, intent_effect: { ok: true, why: 'No risky effect detected.' } }, reason_for_agent: '', mode: 'rules_only', latency_ms: 0 };

  if (category !== 'safe') {
    const measurer = measurers.find((candidate) => candidate.category === category && candidate.matches(req));
    const measurement = measurer ? await measurer.measure(req, { config, task, workspaceRoot: req.cwd }) : { facts: [], judgeContext: { command: req.command } };
    const judged = await judge.judge({ task, intent: req.intent, speaker: 'agent', category, judgeContext: measurement.judgeContext });
    response = fromJudge(check_id, category, measurement.facts, judged);
    response = applyPolicy(response, config, category, measurement.judgeContext as Record<string, unknown>);
    const shouldAsk = config.human_check === 'risky' || (config.human_check === 'blocked_only' && response.verdict === 'block');
    if (shouldAsk) response = await holdForHuman({ check_id, request: req, response, task, category, measurement, config, judge });
  }

  response.latency_ms = Date.now() - started;
  bus.emit({ type: 'check.finished', check_id, request: req, response, at: Date.now() });
  await audit(req.cwd, { request: req, response, task, at: Date.now() });
  return response;
}

function fromJudge(check_id: string, category: CheckRequest['source'] extends never ? never : Exclude<ReturnType<typeof classify>, 'safe'>, facts: VerdictResponse['facts'], result: JudgeResult): VerdictResponse {
  return { check_id, verdict: result.suggested_verdict, category, headline: result.headline, facts, layers: { task_fit: result.task_fit, intent_effect: result.intent_effect }, reason_for_agent: result.reason_for_agent, mode: result.mode, latency_ms: 0 };
}
