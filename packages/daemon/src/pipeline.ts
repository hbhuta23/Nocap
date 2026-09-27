import { randomUUID } from 'node:crypto';
import { GeminiJudge } from '@nocap/judge';
import type { Category, CheckRequest, JudgeResult, Measurement, VerdictResponse } from '@nocap/shared';
import { bus } from './bus';
import { audit } from './audit';
import { classify } from './classifier';
import { loadConfig } from './config';
import { holdForHuman } from './humanCheck';
import { measurers } from './measurers';
import { applyPolicy } from './policy';
import { rulesMentioned } from './rules';
import { tamperTarget } from './guard';
import { noteEdit } from './measurers/testDiff';
import { sessions } from './sessions';

const judge = new GeminiJudge();

export async function runCheck(req: CheckRequest): Promise<VerdictResponse> {
  const started = Date.now();
  const check_id = `chk_${randomUUID()}`;
  bus.emit({ type: 'check.started', check_id, request: req, at: started });
  // An agent may not change nocap's own setup (config, hook files, logs): blocked outright, no judge, no pop-up.
  const tampered = tamperTarget(req);
  if (tampered) {
    const reason = `Blocked by nocap: agents can't change nocap's own files (${tampered}). Ask the developer; they can change nocap's settings in the nocap panel.`;
    const response: VerdictResponse = {
      check_id, verdict: 'block', category: 'security', headline: "CAP DETECTED: agent tried to change nocap's own setup",
      facts: [{ label: 'Protected file', value: tampered, severity: 'high' }],
      layers: { task_fit: { ok: true, why: 'Not judged: tamper protection' }, intent_effect: { ok: false, why: `Would change ${tampered}, which only the developer may change` } },
      reason_for_agent: reason, mode: 'rules_only', latency_ms: Date.now() - started,
    };
    bus.emit({ type: 'check.finished', check_id, request: req, response, at: Date.now() });
    await audit(req.cwd, { request: req, response, at: Date.now() });
    return response;
  }

  const classified = classify(req);
  const config = loadConfig(req.cwd);
  const task = sessions.getTask(req.session_id) ?? sessions.getTaskForWorkspace(req.cwd) ?? sessions.getTask('panel');
  const rules = config.rules ?? [];
  noteEdit(req, config.tests?.globs); // FR-T4: remember which source files this session changed
  let response: VerdictResponse = { check_id, verdict: 'allow', category: classified, headline: 'Allowed', facts: [], layers: { task_fit: { ok: true, why: 'Safe command; no deep check needed.' }, intent_effect: { ok: true, why: 'No risky effect detected.' } }, reason_for_agent: '', mode: 'rules_only', latency_ms: 0 };

  // Safe actions skip the judge (FR-G1) unless they mention something a team rule is about.
  const ruleOnly = classified === 'safe' && rulesMentioned(rules, req).length > 0;

  if (classified !== 'safe' || ruleOnly) {
    const category: Category = ruleOnly ? 'rule' : classified;
    const measurer = ruleOnly ? undefined : measurers.find((candidate) => candidate.category === category && candidate.matches(req));
    const measurement: Measurement = measurer
      ? await measurer.measure(req, { config, task, workspaceRoot: req.cwd })
      : { facts: [], judgeContext: actionContext(req) };
    const judged = await judge.judge({ task, intent: req.intent, speaker: 'agent', category, judgeContext: measurement.judgeContext, redactColumns: config.database?.redact_columns, rules });
    // A rule-only check exists to enforce team rules, nothing else: a safe action is never stopped for
    // task fit (FR-G1 never judges it), so without a broken rule it stays allowed.
    if (ruleOnly && !judged.violated_rule) {
      response.latency_ms = Date.now() - started;
      bus.emit({ type: 'check.finished', check_id, request: req, response, at: Date.now() });
      await audit(req.cwd, { request: req, response, task, rules_checked: true, at: Date.now() });
      return response;
    }
    response = fromJudge(check_id, category, measurement.facts, judged);
    if (judged.violated_rule) {
      response.category = 'rule';
      response.facts = [{ label: 'Team rule broken', value: judged.violated_rule, severity: 'high' }, ...response.facts];
    }
    response = applyPolicy(response, config, category, measurement.judgeContext as Record<string, unknown>);
    // A rule-only check that found nothing wrong is still a safe action: no pop-up.
    const needsHuman = !(ruleOnly && response.verdict === 'allow');
    const shouldAsk = needsHuman && (config.human_check === 'risky' || (config.human_check === 'blocked_only' && response.verdict === 'block'));
    if (shouldAsk) response = await holdForHuman({ check_id, request: req, response, task, category: response.category, measurement, config, judge });
  }

  response.latency_ms = Date.now() - started;
  bus.emit({ type: 'check.finished', check_id, request: req, response, at: Date.now() });
  await audit(req.cwd, { request: req, response, task, at: Date.now() });
  return response;
}

/** What the judge sees for an action no measurer handles: the command, or the edited file and new text. */
function actionContext(req: CheckRequest): object {
  return req.edit
    ? { command: req.command, file: req.edit.file, new_content_excerpt: req.edit.new.slice(0, 2000) }
    : { command: req.command };
}

function fromJudge(check_id: string, category: Category, facts: VerdictResponse['facts'], result: JudgeResult): VerdictResponse {
  return { check_id, verdict: result.suggested_verdict, category, headline: result.headline, facts, layers: { task_fit: result.task_fit, intent_effect: result.intent_effect }, reason_for_agent: result.reason_for_agent, mode: result.mode, latency_ms: 0 };
}
