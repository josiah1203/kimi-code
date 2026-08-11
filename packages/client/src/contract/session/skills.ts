/**
 * `sessionSkillCatalog` — the session-merged skill catalog. Mirrors
 * `SpiderByte Agent Core/session/sessionSkillCatalog/skillCatalog.ts` (the thin
 * `list()` method; the `catalog` / `ready` properties and the sink interface
 * are not wire methods). `SkillSummary` mirrors
 * `SpiderByte Agent Core/app/skillCatalog/types.ts`.
 */

import { z } from 'zod';

import type { ServiceContract } from '../types.js';

export const skillSummarySchema = z.object({
  name: z.string(),
  description: z.string(),
  path: z.string(),
  source: z.enum(['project', 'user', 'extra', 'builtin']),
  type: z.string().optional(),
  disableModelInvocation: z.boolean().optional(),
  isSubSkill: z.boolean().optional(),
});

export const sessionSkillCatalogContract = {
  list: { input: z.tuple([]), output: z.array(skillSummarySchema) },
} satisfies ServiceContract;
