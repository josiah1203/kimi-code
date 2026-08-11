/** Local/BYOK authentication contracts. Hosted account flows are excluded. */

import { z } from 'zod';

import { noResult } from '../helpers.js';
import type { ServiceContract } from '../types.js';

export const authStatusSchema = z.object({
  loggedIn: z.boolean(),
  provider: z.string().optional(),
});

export const authContract = {
  status: { input: z.tuple([z.string().optional()]), output: authStatusSchema },
} satisfies ServiceContract;

export const authSummaryContract = {
  summarize: { input: z.tuple([]), output: z.array(authStatusSchema) },
  ensureReady: { input: z.tuple([z.string().optional()]), output: noResult },
} satisfies ServiceContract;
