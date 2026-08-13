import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  delegatedPrincipalSchema,
  type DelegatedPrincipal,
} from '@spiderbyte/protocol';

export const DELEGATED_PRINCIPAL_HEADER = 'x-spiderbyte-delegated-principal';
export const DELEGATED_PRINCIPAL_PREFIX = 'sbp1';
export const DEFAULT_DELEGATED_PRINCIPAL_MAX_AGE_MS = 5 * 60 * 1_000;
export const DEFAULT_DELEGATED_PRINCIPAL_MAX_FUTURE_SKEW_MS = 30 * 1_000;
const MIN_SECRET_LENGTH = 32;

export type DelegatedPrincipalVerificationErrorCode =
  | 'not_configured'
  | 'malformed'
  | 'invalid_signature'
  | 'expired'
  | 'issued_in_future';

export class DelegatedPrincipalVerificationError extends Error {
  readonly code: DelegatedPrincipalVerificationErrorCode;

  constructor(code: DelegatedPrincipalVerificationErrorCode) {
    super('invalid delegated principal assertion');
    this.name = 'DelegatedPrincipalVerificationError';
    this.code = code;
  }
}

export interface DelegatedPrincipalVerificationOptions {
  readonly now?: () => number;
  readonly maxAgeMs?: number;
  readonly maxFutureSkewMs?: number;
}

function assertSecret(secret: string | undefined): string {
  if (secret === undefined || secret.length < MIN_SECRET_LENGTH) {
    throw new DelegatedPrincipalVerificationError('not_configured');
  }
  return secret;
}

function signingInput(principal: DelegatedPrincipal): string {
  const parsed = delegatedPrincipalSchema.parse(principal);
  // Keep field order explicit so BFF implementations in other runtimes can
  // reproduce the signed bytes without depending on Zod internals.
  const payload = JSON.stringify({
    version: parsed.version,
    audience: parsed.audience,
    actor_id: parsed.actor_id,
    subject_id: parsed.subject_id,
    organization_id: parsed.organization_id,
    issued_at: parsed.issued_at,
    expires_at: parsed.expires_at,
  });
  return `${DELEGATED_PRINCIPAL_PREFIX}.${Buffer.from(payload, 'utf8').toString('base64url')}`;
}

function signatureFor(input: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(input, 'utf8').digest();
}

/** Create an assertion for a trusted server boundary or a test fixture. */
export function createDelegatedPrincipalAssertion(
  principal: DelegatedPrincipal,
  secret: string,
): string {
  const configuredSecret = assertSecret(secret);
  const input = signingInput(principal);
  return `${input}.${signatureFor(input, configuredSecret).toString('base64url')}`;
}

/** Verify a short-lived assertion without exposing its contents in errors. */
export function verifyDelegatedPrincipalAssertion(
  assertion: string,
  secret: string | undefined,
  options: DelegatedPrincipalVerificationOptions = {},
): DelegatedPrincipal {
  const configuredSecret = assertSecret(secret);
  const parts = assertion.split('.');
  const [prefix, encodedPayload, encodedSignature] = parts;
  if (parts.length !== 3 || prefix !== DELEGATED_PRINCIPAL_PREFIX || encodedPayload === undefined || encodedPayload.length === 0 || encodedSignature === undefined || encodedSignature.length === 0) {
    throw new DelegatedPrincipalVerificationError('malformed');
  }

  const input = `${prefix}.${encodedPayload}`;
  let presentedSignature: Buffer;
  let payload: DelegatedPrincipal;
  try {
    presentedSignature = Buffer.from(encodedSignature, 'base64url');
    payload = delegatedPrincipalSchema.parse(JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')));
  } catch {
    throw new DelegatedPrincipalVerificationError('malformed');
  }

  const expectedSignature = signatureFor(input, configuredSecret);
  if (presentedSignature.length !== expectedSignature.length || !timingSafeEqual(presentedSignature, expectedSignature)) {
    throw new DelegatedPrincipalVerificationError('invalid_signature');
  }

  const now = (options.now ?? Date.now)();
  const issuedAt = Date.parse(payload.issued_at);
  const expiresAt = Date.parse(payload.expires_at);
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_DELEGATED_PRINCIPAL_MAX_AGE_MS;
  const maxFutureSkewMs = options.maxFutureSkewMs ?? DEFAULT_DELEGATED_PRINCIPAL_MAX_FUTURE_SKEW_MS;
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt || expiresAt - issuedAt > maxAgeMs || expiresAt <= now) {
    throw new DelegatedPrincipalVerificationError('expired');
  }
  if (issuedAt > now + maxFutureSkewMs) {
    throw new DelegatedPrincipalVerificationError('issued_in_future');
  }
  return payload;
}
