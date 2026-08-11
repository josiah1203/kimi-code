/**
 * `authSummary` domain — local readiness summary with a v1 wire adapter.
 *
 * Implements the `GET /api/v1/auth` `AuthSummary` wire contract on top of the
 * native v2 provider and model services. The `managed_provider` field is
 * retained as a null compatibility field for released v1 clients; Open Core
 * never populates it with an account identity.
 * Bound at App scope — it is a stateless projector over the global provider /
 * model / credential state.
 */

import { z } from 'zod';

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';

export const authSummarySchema = z.object({
  ready: z.boolean(),
  providers_count: z.number().int().nonnegative(),
  default_model: z.string().nullable(),
  /** Retained as a null-only wire field for older local clients. */
  managed_provider: z.null(),
});
export type AuthSummary = z.infer<typeof authSummarySchema>;

export interface IAuthReadinessService {
  readonly _serviceBrand: undefined;

  get(): Promise<AuthSummary>;
}

export const IAuthReadinessService: ServiceIdentifier<IAuthReadinessService> =
  createDecorator<IAuthReadinessService>('authReadinessService');
