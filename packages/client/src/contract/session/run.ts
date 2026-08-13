/**
 * `sessionRunService` — durable platform Run lifecycle. The schemas come from
 * the protocol package so klient validates the same objects as the engine and
 * Node SDK.
 */

import { z } from 'zod';

import { maybe } from '../helpers.js';
import {
  attemptActionInputSchema,
  attemptCreateInputSchema,
  attemptIdSchema,
  attemptSchema,
  attemptTransitionInputSchema,
  runCreateInputSchema,
  runActionInputSchema,
  runForkInputSchema,
  runIdSchema,
  runSchema,
  runTransitionInputSchema,
} from '../platform.js';
import type { ServiceContract } from '../types.js';

export const sessionRunContract = {
  list: { input: z.tuple([]), output: z.array(runSchema) },
  get: { input: z.tuple([runIdSchema]), output: maybe(runSchema) },
  listAttempts: { input: z.tuple([runIdSchema.optional()]), output: z.array(attemptSchema) },
  getAttempt: { input: z.tuple([attemptIdSchema]), output: maybe(attemptSchema) },
  create: { input: z.tuple([runCreateInputSchema]), output: runSchema },
  createAttempt: {
    input: z.tuple([runIdSchema, attemptCreateInputSchema]),
    output: maybe(attemptSchema),
  },
  transition: {
    input: z.tuple([runIdSchema, runTransitionInputSchema]),
    output: maybe(runSchema),
  },
  transitionAttempt: {
    input: z.tuple([attemptIdSchema, attemptTransitionInputSchema]),
    output: maybe(attemptSchema),
  },
  resume: {
    input: z.tuple([runIdSchema, runActionInputSchema]),
    output: maybe(runSchema),
  },
  resumeAttempt: {
    input: z.tuple([attemptIdSchema, attemptActionInputSchema]),
    output: maybe(attemptSchema),
  },
  cancel: {
    input: z.tuple([runIdSchema, runActionInputSchema]),
    output: maybe(runSchema),
  },
  cancelAttempt: {
    input: z.tuple([attemptIdSchema, attemptActionInputSchema]),
    output: maybe(attemptSchema),
  },
  retry: {
    input: z.tuple([runIdSchema, runActionInputSchema]),
    output: maybe(runSchema),
  },
  retryAttempt: {
    input: z.tuple([runIdSchema, attemptActionInputSchema]),
    output: maybe(attemptSchema),
  },
  rerun: {
    input: z.tuple([runIdSchema, runActionInputSchema]),
    output: maybe(runSchema),
  },
  fork: {
    input: z.tuple([runIdSchema, runForkInputSchema]),
    output: maybe(runSchema),
  },
} satisfies ServiceContract;
