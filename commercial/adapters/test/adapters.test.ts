import { describe, expect, it } from 'vitest';

import {
  DeterministicTokenGenerator,
  DevelopmentIdentityAdapter,
  InMemoryAuditWriter,
  InMemoryCommercialStore,
  MonotonicIdGenerator,
  StaticCapabilityRegistry,
  UnavailableCapabilityAdapter,
  UnavailableIdentityAdapter,
} from '@spiderbyte/commercial-adapters';
import { ClerkBillingAdapter, ClerkIdentityAdapter } from '../src/clerk';

const now = '2026-08-11T12:00:00.000Z';
const clock = { now: () => now };

describe('commercial deterministic adapters', () => {
  it('keeps local development identity explicit and revocable', async () => {
    const identity = new DevelopmentIdentityAdapter({
      environment: 'development',
      clock,
      tokenGenerator: new DeterministicTokenGenerator(),
    });
    const registration = await identity.register({
      account_id: 'acct_01',
      user_id: 'usr_01',
      email: 'person@example.test',
      display_name: 'Person',
      secret: 'a-development-secret',
    });
    expect(registration.auth_method).toBe('development');
    const auth = await identity.authenticate({ email: 'person@example.test', secret: 'a-development-secret' });
    expect(auth?.principal.user_id).toBe('usr_01');
    expect(await identity.authenticate({ email: 'person@example.test', secret: 'wrong-secret' })).toBeUndefined();
    expect(await identity.validateSession(auth!.session_token)).toBeDefined();
    await identity.revokeSession(auth!.principal.session_id!);
    expect(await identity.validateSession(auth!.session_token)).toBeUndefined();
  });

  it('fails closed when a hosted capability has no adapter', async () => {
    const identity = new UnavailableIdentityAdapter();
    expect(identity.capability().availability).toBe('not_configured');
    await expect(identity.validateSession('token')).rejects.toMatchObject({
      code: 'commercial.identity.not_configured',
    });

    const adapter = new UnavailableCapabilityAdapter('hosted_compute', 'not_configured', 'worker fleet is not configured');
    expect(adapter.capability().availability).toBe('not_configured');
    expect(() => adapter.assertAvailable()).toThrow();
    expect(new StaticCapabilityRegistry().status('payment').availability).toBe('not_configured');
  });

  it('fails closed when Clerk hosted adapters are not configured', async () => {
    const identity = new ClerkIdentityAdapter();
    const billing = new ClerkBillingAdapter();
    expect(identity.capability().availability).toBe('not_configured');
    expect(billing.capability().availability).toBe('not_configured');
    await expect(identity.validateSession('token')).rejects.toMatchObject({
      code: 'commercial.identity.not_configured',
    });
    await expect(billing.listPlans('user')).rejects.toMatchObject({
      code: 'commercial.payment.not_configured',
    });
  });

  it('serializes in-memory transactions and maintains an audit hash chain', async () => {
    const store = new InMemoryCommercialStore();
    await store.transaction(async (transaction) => {
      await transaction.put('idempotency', 'request-1', {
        scope: 'test',
        request_id: 'request-1',
        fingerprint: 'fingerprint',
        result_json: '{}',
        created_at: now,
      });
    });
    expect(await store.get('idempotency', 'request-1')).toMatchObject({ request_id: 'request-1' });

    const audit = new InMemoryAuditWriter();
    await audit.append({
      account_id: 'acct_01',
      actor: { kind: 'system', id: 'test-system' },
      action: 'test.write',
      target_type: 'test',
      target_id: 'test_01',
      outcome: 'succeeded',
      request_id: 'request-1',
      occurred_at: now,
    });
    await audit.append({
      account_id: 'acct_01',
      actor: { kind: 'system', id: 'test-system' },
      action: 'test.read',
      target_type: 'test',
      target_id: 'test_01',
      outcome: 'allowed',
      request_id: 'request-2',
      occurred_at: now,
    });
    expect(await audit.verifyIntegrity()).toBe(true);
    expect(audit.list()).toHaveLength(2);
  });

  it('generates monotonic IDs with the requested namespace', () => {
    const ids = new MonotonicIdGenerator();
    expect(ids.next('org_')).toBe('org_0001');
    expect(ids.next('org_')).toBe('org_0002');
  });
});
