import { describe, expect, it } from 'vitest';

import {
  InMemoryAuditWriter,
  InMemoryCommercialStore,
  LocalTestComputeAdapter,
  MonotonicIdGenerator,
} from '../../adapters/src/index';
import { CommercialEntitlementService, UsageLedgerService } from '@spiderbyte/commercial-billing';
import { HostedComputeControlPlane } from '@spiderbyte/commercial-compute';
import { principalSchema } from '@spiderbyte/commercial-domain';

const now = '2026-08-11T12:00:00.000Z';
const actor = { kind: 'system' as const, id: 'compute-test' };
const principal = principalSchema.parse({
  subject_id: 'usr_compute',
  account_id: 'acct_01',
  user_id: 'usr_compute',
  session_id: 'ses_compute',
  organization_ids: ['org_01'],
  scopes: ['compute.submit', 'compute.cancel'],
  auth_method: 'session',
  issued_at: now,
  expires_at: '2026-08-12T12:00:00.000Z',
});

async function createPlane(adapter = new LocalTestComputeAdapter()) {
  const store = new InMemoryCommercialStore();
  const audit = new InMemoryAuditWriter();
  const clock = { now: () => now };
  const ids = new MonotonicIdGenerator();
  const entitlement = new CommercialEntitlementService({ store, clock, ids, audit });
  const plans = await entitlement.seedDefaultPlans('acct_01', actor);
  await entitlement.changeSubscription({ account_id: 'acct_01', organization_id: 'org_01', plan_id: plans[0]!.id, actor, request_id: 'compute-subscription' });
  await entitlement.setEntitlement({ account_id: 'acct_01', organization_id: 'org_01', key: 'hosted_compute', status: 'included', value: true, source: 'adapter', actor, request_id: 'compute-entitlement' });
  const usage = new UsageLedgerService({ store, clock, ids, audit });
  const plane = new HostedComputeControlPlane({
    store,
    adapter,
    entitlement,
    usage,
    authorize: { authorize: async () => undefined },
    clock,
    ids,
    audit,
  });
  const provider = await plane.registerProvider({ account_id: 'acct_01', organization_id: 'org_01', name: 'Test worker', provider_type: 'local_test', supported_regions: ['local'], capabilities: ['cpu'], actor, request_id: 'provider-1' });
  const region = await plane.registerRegion({ account_id: 'acct_01', organization_id: 'org_01', provider_id: provider.id, name: 'Local', residency: 'test', actor, request_id: 'region-1' });
  const jobClass = await plane.registerJobClass({ account_id: 'acct_01', organization_id: 'org_01', name: 'small', cpu_millis: 1000, gpu_count: 0, memory_bytes: 1024, storage_bytes: 1024, actor, request_id: 'job-class-1' });
  return { plane, adapter, store, provider, region, jobClass };
}

describe('hosted compute control plane', () => {
  it('does not claim running until the worker confirms execution and reconciles lifecycle state', async () => {
    const { plane, adapter, provider, region, jobClass, store } = await createPlane();
    const reservation = await plane.submit({
      principal,
      account_id: 'acct_01',
      organization_id: 'org_01',
      workspace_id: 'cws_01',
      provider_id: provider.id,
      region_id: region.id,
      job_class_id: jobClass.id,
      requested_seconds: 5,
      price_basis: { unit_price_minor: 1, multiplier: 1, currency: 'USD', price_book_id: 'compute-test' },
      actor,
      request_id: 'compute-submit-1',
    });
    expect(reservation.state).toBe('starting');
    expect((await plane.submit({
      principal,
      account_id: 'acct_01',
      organization_id: 'org_01',
      workspace_id: 'cws_01',
      provider_id: provider.id,
      region_id: region.id,
      job_class_id: jobClass.id,
      requested_seconds: 5,
      price_basis: { unit_price_minor: 1, multiplier: 1, currency: 'USD', price_book_id: 'compute-test' },
      actor,
      request_id: 'compute-submit-1',
    })).id).toBe(reservation.id);
    await expect(plane.submit({
      principal,
      account_id: 'acct_01',
      organization_id: 'org_01',
      workspace_id: 'cws_01',
      provider_id: provider.id,
      region_id: region.id,
      job_class_id: jobClass.id,
      requested_seconds: 6,
      price_basis: { unit_price_minor: 1, multiplier: 1, currency: 'USD', price_book_id: 'compute-test' },
      actor,
      request_id: 'compute-submit-1',
    })).rejects.toMatchObject({ code: 'commercial.compute.idempotency_reused' });
    expect((await store.list('compute_executions'))).toHaveLength(1);
    const execution = (await store.list('compute_executions'))[0]!;
    adapter.setState(execution.id, 'succeeded');
    const inspected = await plane.refresh(principal, 'org_01', 'cws_01', execution.id, 'compute-refresh-1');
    expect(inspected.state).toBe('succeeded');
    expect((await store.get('compute_reservations', reservation.id))?.state).toBe('succeeded');
  });

  it('cancels a confirmed execution and releases its reservation', async () => {
    const { plane, provider, region, jobClass, store } = await createPlane();
    const reservation = await plane.submit({
      principal, account_id: 'acct_01', organization_id: 'org_01', workspace_id: 'cws_01',
      provider_id: provider.id, region_id: region.id, job_class_id: jobClass.id, requested_seconds: 3,
      price_basis: { unit_price_minor: 1, multiplier: 1, currency: 'USD', price_book_id: 'compute-test' },
      actor, request_id: 'compute-submit-2',
    });
    const execution = (await store.list('compute_executions'))[0]!;
    const canceled = await plane.cancel({ principal, organization_id: 'org_01', workspace_id: 'cws_01', execution_id: execution.id, actor, request_id: 'compute-cancel-1' });
    expect(canceled.state).toBe('canceled');
    expect((await store.get('compute_reservations', reservation.id))?.state).toBe('canceled');
  });

  it('rejects hosted compute when the organization lacks the entitlement', async () => {
    const setup = await createPlane();
    const entitlement = await setup.store.list('entitlements');
    for (const entry of entitlement) await setup.store.delete('entitlements', entry.id);
    await expect(setup.plane.submit({
      principal, account_id: 'acct_01', organization_id: 'org_01', workspace_id: 'cws_01',
      provider_id: setup.provider.id, region_id: setup.region.id, job_class_id: setup.jobClass.id, requested_seconds: 1,
      price_basis: { unit_price_minor: 1, multiplier: 1, currency: 'USD', price_book_id: 'compute-test' },
      actor, request_id: 'compute-submit-denied',
    })).rejects.toMatchObject({ code: 'commercial.billing.entitlement_not_included' });
  });
});
