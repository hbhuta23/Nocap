// Measurer registry (§6.5). Owner: Role B.
// Adding a category = writing one Measurer and listing it here. Nothing else changes.
//
// Planned:
//   sql.ts       B6–B8  FR-D1..D4  (dry run in a rolled-back transaction; NEVER commit)
//   files.ts     B9     FR-D5
//   spend.ts     B10    FR-S2..S5  (uses the judge's extractSpend for FR-S1)
//   testDiff.ts  B11    FR-T1..T5
//   patterns.ts  B12    FR-B1..B3  (rules as data)

import type { Measurer } from '@nocap/shared';

export const measurers: Measurer[] = [];
