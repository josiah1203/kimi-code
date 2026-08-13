import { describe, expect, it } from 'vitest';

import {
  createDelegatedPrincipalAssertion,
  DelegatedPrincipalVerificationError,
  verifyDelegatedPrincipalAssertion,
} from '../src/services/auth/delegatedPrincipal';

const SECRET = 'delegated-principal-test-secret-0123456789';
const NOW = Date.parse('2026-08-12T12:00:00.000Z');

function principal() {
  return {
    version: 1 as const,
    audience: 'spiderbyte-platform' as const,
    actor_id: 'usr_example',
    subject_id: 'clerk_example',
    organization_id: 'org_example',
    issued_at: new Date(NOW - 1_000).toISOString(),
    expires_at: new Date(NOW + 30_000).toISOString(),
  };
}

describe('delegated principal assertions', () => {
  it('round-trips a provider-neutral principal and rejects tampering', () => {
    const assertion = createDelegatedPrincipalAssertion(principal(), SECRET);
    expect(verifyDelegatedPrincipalAssertion(assertion, SECRET, { now: () => NOW })).toEqual(principal());

    const [prefix, payload, signature] = assertion.split('.');
    const tampered = `${prefix}.${payload}.A${signature?.slice(1) ?? ''}`;
    expect(() => verifyDelegatedPrincipalAssertion(tampered, SECRET, { now: () => NOW }))
      .toThrowError(DelegatedPrincipalVerificationError);
  });

  it('rejects expired, future, and undersized-secret assertions', () => {
    const expired = createDelegatedPrincipalAssertion({
      ...principal(),
      issued_at: new Date(NOW - 60_000).toISOString(),
      expires_at: new Date(NOW - 1).toISOString(),
    }, SECRET);
    expect(() => verifyDelegatedPrincipalAssertion(expired, SECRET, { now: () => NOW }))
      .toThrowError(DelegatedPrincipalVerificationError);

    const future = createDelegatedPrincipalAssertion({
      ...principal(),
      issued_at: new Date(NOW + 60_001).toISOString(),
      expires_at: new Date(NOW + 90_001).toISOString(),
    }, SECRET);
    expect(() => verifyDelegatedPrincipalAssertion(future, SECRET, { now: () => NOW }))
      .toThrowError(DelegatedPrincipalVerificationError);

    expect(() => createDelegatedPrincipalAssertion(principal(), 'too-short'))
      .toThrowError(DelegatedPrincipalVerificationError);
  });
});
