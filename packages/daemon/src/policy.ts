import type { Category, NocapConfig, Verdict, VerdictResponse } from '@nocap/shared';

export function applyPolicy(response: VerdictResponse, config: NocapConfig, category: Category, context: Record<string, unknown>): VerdictResponse {
  const hardBlock = typeof context.hardBlock === 'string' ? context.hardBlock : undefined;
  if (hardBlock) return blocked(response, hardBlock);
  if (category === 'data') {
    const operation = String(context.operation ?? '').toLowerCase();
    const protectedTable = (config.database?.protected_tables ?? []).find((table) => new RegExp(`\\b${escapeRegExp(table.toLowerCase())}\\b`).test(operation));
    if (protectedTable) return blocked(response, `The protected table ${protectedTable} cannot be changed by an agent.`);
  }
  if (category === 'spend' && typeof context.estimateUsd === 'number' && context.estimateUsd > config.budget.per_command_usd) {
    return blocked(response, `Estimated cost is $${context.estimateUsd.toFixed(2)}, above the $${config.budget.per_command_usd.toFixed(2)} command budget. Run a smaller batch first.`);
  }
  if (category === 'secrets') return blocked(response, 'This action may expose a secret. Remove the secret from the command or file and use a secret manager.');
  if (category === 'prod') return { ...response, verdict: 'ask', headline: 'Developer confirmation required for production action', reason_for_agent: 'This action targets a production system. Confirm the exact target and scope with the developer.' };
  return response;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function blocked(response: VerdictResponse, reason: string): VerdictResponse {
  return { ...response, verdict: 'block' as Verdict, headline: response.headline.startsWith('CAP') ? response.headline : 'CAP DETECTED: policy blocked this action', reason_for_agent: `Blocked by nocap: ${reason}`, layers: { ...response.layers, intent_effect: { ok: false, why: reason } } };
}