import { z } from 'zod';

import { isoDateTimeSchema } from './time';
import { platformIdentifierSchema } from './platform';

/**
 * A short-lived, server-to-server identity assertion.
 *
 * The assertion carries only provider-neutral identifiers. Its signature is
 * deliberately implemented by the server boundaries that hold the shared
 * secret; this package owns the wire shape, not credential material.
 */
export const delegatedPrincipalSchema = z.strictObject({
  version: z.literal(1),
  audience: z.literal('spiderbyte-platform'),
  actor_id: platformIdentifierSchema,
  subject_id: platformIdentifierSchema,
  organization_id: platformIdentifierSchema.optional(),
  issued_at: isoDateTimeSchema,
  expires_at: isoDateTimeSchema,
});

export type DelegatedPrincipal = z.infer<typeof delegatedPrincipalSchema>;
