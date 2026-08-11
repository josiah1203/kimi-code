/**
 * GET /v1/auth
 *   Reply: AuthSummary {
 *     ready,
 *     providers_count,
 *     default_model,
 *     managed_provider (always null in Open Core)
 *   }
 */
import { z } from 'zod';

export const authSummarySchema = z.object({
  ready: z.boolean(),
  providers_count: z.number().int().nonnegative(),
  default_model: z.string().nullable(),
  managed_provider: z.null(),
});
export type AuthSummary = z.infer<typeof authSummarySchema>;
