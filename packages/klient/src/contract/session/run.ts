/**
 * `sessionRunService` — durable platform Run lifecycle. The schemas come from
 * the protocol package so klient validates the same objects as the engine and
 * Node SDK.
 */

import { z } from 'zod';

import { maybe } from '../helpers.js';
import {
  runCreateInputSchema,
  runIdSchema,
  runSchema,
  runTransitionInputSchema,
} from '../platform.js';
import type { ServiceContract } from '../types.js';

export const sessionRunContract = {
  list: { input: z.tuple([]), output: z.array(runSchema) },
  get: { input: z.tuple([runIdSchema]), output: maybe(runSchema) },
  create: { input: z.tuple([runCreateInputSchema]), output: runSchema },
  transition: {
    input: z.tuple([runIdSchema, runTransitionInputSchema]),
    output: maybe(runSchema),
  },
} satisfies ServiceContract;
