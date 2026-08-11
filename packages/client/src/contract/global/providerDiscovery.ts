/**
 * `providerDiscovery` — the engine's `IProviderDiscoveryService`: remote
 * provider-model discovery and config sync. Mirrors
 * `SpiderByte Agent Core/app/kosongConfig/discovery.ts`.
 */

import { z } from 'zod';

import type { ServiceContract } from '../types.js';

export const refreshProviderModelsOptionsSchema = z.object({
  scope: z.literal('all').optional(),
  providerId: z.string().optional(),
});

/** Same shape as the local provider discovery response — keep in sync with the engine. */
export const refreshProviderModelsResponseSchema = z.object({
  changed: z.array(
    z.object({
      provider_id: z.string(),
      provider_name: z.string(),
      added: z.number(),
      removed: z.number(),
    }),
  ),
  unchanged: z.array(z.string()),
  failed: z.array(z.object({ provider: z.string(), reason: z.string() })),
});

export const providerDiscoveryContract = {
  refreshProviderModels: {
    input: z.tuple([refreshProviderModelsOptionsSchema.optional()]),
    output: refreshProviderModelsResponseSchema,
  },
} satisfies ServiceContract;
