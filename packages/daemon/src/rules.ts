// Team rules (.nocap.yml `rules`): plain-English standards no agent action may break. Owner: Role A.
//
// Risky actions are always judged, with the rules included. A "safe" action (FR-G1: <50 ms, no AI) is only
// sent to the judge when it mentions something a rule is about: "Never touch the payments table" makes
// any command or edit mentioning "payment" worth a check. That test is local string matching.

const STOPWORDS = new Set(
  (
    'never always dont do not no should must shall may can cannot the a an any anything anyone every ever ' +
    'without with before after from into onto that this these those than then more less over under above below ' +
    'change changes changing edit edits modify touch delete deletes remove removes drop run runs use make pass ' +
    'passes fix update write writes create add file files code table tables agent agents ask asks first only also ' +
    'allowed allow again when what which them they there here their our your its it be is are was were been being ' +
    'unless except instead something anything nothing everything keep stay stays need needs needed get got let ' +
    'and or but for to of on in at by as if so up out off via per ' +
    // covered by their own checks, and too common to route every command to the judge
    'test tests testing spec specs command commands script scripts'
  ).split(/\s+/),
);

/** Distinctive words of a rule, singularised: "Never touch the payments table" → ["payment"]. */
export function ruleKeywords(rule: string): string[] {
  const words = rule.toLowerCase().replace(/[’']/g, '').match(/[a-z0-9_./-]+/g) ?? [];
  const out = new Set<string>();
  for (const raw of words) {
    const w = raw.replace(/^[./-]+|[./-]+$/g, '');
    if (w.length < 4 || STOPWORDS.has(w)) continue;
    out.add(w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
  }
  return [...out];
}

/** Rules whose keywords appear in this action (command, edited file path, or new content). */
export function rulesMentioned(rules: string[], action: { command: string; edit?: { file: string; new: string } }): string[] {
  if (!rules.length) return [];
  const text = `${action.command}\n${action.edit?.file ?? ''}\n${(action.edit?.new ?? '').slice(0, 4000)}`.toLowerCase();
  return rules.filter((rule) => ruleKeywords(rule).some((k) => text.includes(k)));
}
