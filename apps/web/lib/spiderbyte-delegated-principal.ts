import { createHash, createHmac } from 'node:crypto';

import {
  delegatedPrincipalSchema,
  type DelegatedPrincipal,
} from '@spiderbyte/protocol';

const MIN_SECRET_LENGTH = 32;
const DELEGATED_PRINCIPAL_PREFIX = 'sbp1';

interface ClerkPrincipalInput {
  readonly userId: string;
  readonly organizationId?: string;
  readonly now?: number;
  readonly ttlMs?: number;
}

/**
 * Sign the same provider-neutral IDs that the commercial Clerk adapter uses.
 * This file is server-only: it is imported by the BFF route, never by client
 * components, and it never accepts a browser-supplied identity value.
 */
export function createClerkDelegatedPrincipalAssertion(
  input: ClerkPrincipalInput,
  secret: string,
): string {
  if (secret.length < MIN_SECRET_LENGTH) throw new Error('identity bridge secret is not configured');
  const now = input.now ?? Date.now();
  const principal: DelegatedPrincipal = delegatedPrincipalSchema.parse({
    version: 1,
    audience: 'spiderbyte-platform',
      actor_id: hashedId('usr_clerk_', input.userId),
      subject_id: hashedId('clerk_', input.userId),
      organization_id: input.organizationId === undefined
        ? undefined
      : mappedOrganizationId(input.organizationId),
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + (input.ttlMs ?? 60_000)).toISOString(),
  });
  const payload = JSON.stringify({
    version: principal.version,
    audience: principal.audience,
    actor_id: principal.actor_id,
    subject_id: principal.subject_id,
    organization_id: principal.organization_id,
    issued_at: principal.issued_at,
    expires_at: principal.expires_at,
  });
  const signingInput = `${DELEGATED_PRINCIPAL_PREFIX}.${Buffer.from(payload, 'utf8').toString('base64url')}`;
  const signature = createHmac('sha256', secret).update(signingInput, 'utf8').digest('base64url');
  return `${signingInput}.${signature}`;
}

function hashedId(prefix: string, value: string): string {
  return `${prefix}${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

/** Keep the same reversible/native-ID rule as the hosted Clerk adapter. */
function mappedOrganizationId(externalOrganizationId: string): string {
  return /^org_[a-zA-Z0-9][a-zA-Z0-9._:-]{1,127}$/u.test(externalOrganizationId)
    ? externalOrganizationId
    : hashedId('org_clerk_', externalOrganizationId);
}
