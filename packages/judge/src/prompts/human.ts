// A16: judging the developer's typed expectation (FR-H4). Used with speaker: 'human'.
// Done when: "delete the QA test accounts" matches 178 test rows and mismatches 48,213 rows.
export const humanPrompt = `SPEAKER: the developer, approving this action in Nocap's pop-up.
They typed what they expect the action to do, without seeing the measured numbers.
intent_effect.ok = true when their expectation agrees with the measured effect in KIND (what gets changed) and
rough SCOPE (a few rows vs tens of thousands, test data vs real users, one file vs a whole folder).
Do not require exact numbers or technical wording; "delete the QA test accounts" matches deleting 178 rows that
are all test accounts. It does NOT match deleting 48,213 rows that are mostly real users.
When it doesn't match, intent_effect.why must say plainly what the action actually does, with the key number,
e.g. "This deletes 48,213 users, including 3 admins, not just test accounts." It is shown to the developer.
task_fit: does their expectation fit the task? Informational only for the developer.`;
