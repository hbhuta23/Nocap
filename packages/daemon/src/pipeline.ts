// classify → measurer → judge → policy → verdict (B5). Owner: Role B.
// STUB (B1): hard-coded verdicts so Role A can build hooks, shims and the pop-up against it.

import { randomUUID } from 'node:crypto';
import type { CheckRequest, VerdictResponse } from '@nocap/shared';
import { bus } from './bus';

export async function runCheck(req: CheckRequest): Promise<VerdictResponse> {
  const started = Date.now();
  const check_id = `chk_${randomUUID()}`;
  bus.emit({ type: 'check.started', check_id, request: req, at: started });

  const response = stubVerdict(req, check_id);
  response.latency_ms = Date.now() - started;

  bus.emit({ type: 'check.finished', check_id, request: req, response, at: Date.now() });
  return response;
}

function stubVerdict(req: CheckRequest, check_id: string): VerdictResponse {
  const risky = /\bDELETE\b|\bDROP\b|\brm\s+-\w*r/i.test(req.command);
  if (!risky) {
    return {
      check_id,
      verdict: 'allow',
      category: 'safe',
      headline: 'Safe',
      facts: [],
      layers: { task_fit: { ok: true, why: 'stub' }, intent_effect: { ok: true, why: 'stub' } },
      reason_for_agent: '',
      mode: 'rules_only',
      latency_ms: 0,
    };
  }
  return {
    check_id,
    verdict: 'block',
    category: 'data',
    headline: "CAP DETECTED: 48,213 rows, not 'test users'",
    facts: [
      { label: 'Rows deleted', value: '48,213', severity: 'high' },
      { label: 'Admin accounts hit', value: '3', severity: 'high' },
      { label: 'Cascaded tables', value: 'orders, sessions', severity: 'medium' },
    ],
    layers: {
      task_fit: { ok: true, why: 'Cleaning test users matches the task' },
      intent_effect: { ok: false, why: 'Intent says test users; 99.6% of affected rows are not test accounts' },
    },
    reason_for_agent:
      'Blocked by nocap: this deletes 48,213 users including 3 admins. Test users have emails ending in @test.local. Narrow the WHERE clause.',
    mode: 'full',
    latency_ms: 0,
  };
}
