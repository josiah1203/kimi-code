import { z } from 'zod';

/**
 * Browser-safe capability reporting for the commercial boundary.
 *
 * A capability being present in this response is diagnostic only. It is not
 * an entitlement grant and never replaces server-side authorization.
 */
export const commercialCapabilityAvailabilitySchema = z.enum([
  'available',
  'not_included',
  'not_configured',
  'temporarily_unavailable',
  'not_implemented',
]);
export type CommercialCapabilityAvailability = z.infer<typeof commercialCapabilityAvailabilitySchema>;

export const commercialCapabilitySchema = z.strictObject({
  capability: z.string().min(1).max(200),
  availability: commercialCapabilityAvailabilitySchema,
  adapter: z.string().min(1).max(200).optional(),
  reason: z.string().min(1).max(2_000),
});
export type CommercialCapability = z.infer<typeof commercialCapabilitySchema>;

export const commercialCapabilitiesResponseSchema = z.strictObject({
  service: z.string().min(1).max(200),
  environment: z.string().min(1).max(200),
  capabilities: z.array(commercialCapabilitySchema),
});
export type CommercialCapabilitiesResponse = z.infer<typeof commercialCapabilitiesResponseSchema>;

/** Browser-safe authenticated commercial session projection. */
export const commercialPrincipalSchema = z.strictObject({
  subject_id: z.string().min(1).max(160),
  account_id: z.string().min(1).max(160),
  user_id: z.string().min(1).max(160).optional(),
  session_id: z.string().min(1).max(160).optional(),
  organization_ids: z.array(z.string().min(1).max(160)).readonly(),
  scopes: z.array(z.string().min(1).max(200)).readonly(),
  auth_method: z.enum(['session', 'api_key', 'service_account', 'development']),
  issued_at: z.string().min(1),
  expires_at: z.string().min(1),
});
export type CommercialPrincipal = z.infer<typeof commercialPrincipalSchema>;

export const commercialOrganizationSummarySchema = z.strictObject({
  id: z.string().min(1).max(160),
  account_id: z.string().min(1).max(160),
  name: z.string().min(1).max(200),
  state: z.enum(['active', 'suspended', 'archived']),
});
export type CommercialOrganizationSummary = z.infer<typeof commercialOrganizationSummarySchema>;

export const commercialSessionResponseSchema = z.strictObject({
  principal: commercialPrincipalSchema,
  organizations: z.array(commercialOrganizationSummarySchema).readonly(),
});
export type CommercialSessionResponse = z.infer<typeof commercialSessionResponseSchema>;
