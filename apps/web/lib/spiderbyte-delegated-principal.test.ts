import { describe, expect, it } from 'vitest';

import { createClerkDelegatedPrincipalAssertion } from './spiderbyte-delegated-principal';

const SECRET = 'delegated-principal-test-secret-0123456789';

describe('web identity bridge assertion', () => {
  it('maps the Clerk subject and native organization ID consistently with the hosted adapter', () => {
    const assertion = createClerkDelegatedPrincipalAssertion({
      userId: 'user_clerk_example',
      organizationId: 'org_clerk_example',
      now: Date.parse('2026-08-12T12:00:00.000Z'),
    }, SECRET);
    const payload = JSON.parse(Buffer.from(assertion.split('.')[1] as string, 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(payload).toMatchObject({
      version: 1,
      audience: 'spiderbyte-platform',
      actor_id: expect.stringMatching(/^usr_clerk_[a-f0-9]{24}$/),
      subject_id: expect.stringMatching(/^clerk_[a-f0-9]{24}$/),
      organization_id: 'org_clerk_example',
    });
    expect(JSON.stringify(payload)).not.toContain('user_clerk_example');
  });

  it('hashes a non-native provider organization ID instead of forwarding it raw', () => {
    const assertion = createClerkDelegatedPrincipalAssertion({
      userId: 'user_clerk_example',
      organizationId: 'clerk-org-example',
      now: Date.parse('2026-08-12T12:00:00.000Z'),
    }, SECRET);
    const payload = JSON.parse(Buffer.from(assertion.split('.')[1] as string, 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(payload.organization_id).toEqual(expect.stringMatching(/^org_clerk_[a-f0-9]{24}$/));
    expect(JSON.stringify(payload)).not.toContain('clerk-org-example');
  });
});
