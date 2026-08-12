import { describe, expect, it } from 'vitest';

import {
  InMemoryAuditWriter,
  InMemoryCommercialStore,
  LocalTestArtifactAdapter,
  MonotonicIdGenerator,
  UnavailableArtifactAdapter,
} from '../../adapters/src/index';
import { CommercialEntitlementService } from '@spiderbyte/commercial-billing';
import { HostedArtifactService } from '@spiderbyte/commercial-artifacts';
import { principalSchema } from '@spiderbyte/commercial-domain';
import type { HostedArtifactAdapter } from '@spiderbyte/commercial-ports';

const now = '2026-08-11T12:00:00.000Z';
const actor = { kind: 'system' as const, id: 'artifact-test' };
const principal = principalSchema.parse({
  subject_id: 'usr_artifact', account_id: 'acct_01', user_id: 'usr_artifact', session_id: 'ses_artifact',
  organization_ids: ['org_01'], scopes: ['artifact.read', 'artifact.write'], auth_method: 'session',
  issued_at: now, expires_at: '2026-08-12T12:00:00.000Z',
});

async function createArtifacts(adapter: HostedArtifactAdapter = new LocalTestArtifactAdapter()) {
  const store = new InMemoryCommercialStore();
  const audit = new InMemoryAuditWriter();
  const clock = { now: () => now };
  const ids = new MonotonicIdGenerator();
  const entitlement = new CommercialEntitlementService({ store, clock, ids, audit });
  const plans = await entitlement.seedDefaultPlans('acct_01', actor);
  await entitlement.changeSubscription({ account_id: 'acct_01', organization_id: 'org_01', plan_id: plans[0]!.id, actor, request_id: 'artifact-subscription' });
  await entitlement.setEntitlement({ account_id: 'acct_01', organization_id: 'org_01', key: 'hosted_artifacts', status: 'included', value: true, source: 'adapter', actor, request_id: 'artifact-entitlement' });
  const service = new HostedArtifactService({
    store, adapter, entitlement, authorize: { authorize: async () => undefined }, clock, ids, audit,
  });
  return { service, store, adapter };
}

describe('hosted artifacts', () => {
  it('uses immutable content addresses and scoped downloads', async () => {
    const { service, adapter } = await createArtifacts();
    const artifact = await service.put({
      principal, account_id: 'acct_01', organization_id: 'org_01', workspace_id: 'cws_01', name: 'result.json', media_type: 'application/json',
      bytes: new TextEncoder().encode('{"ok":true}'), actor, request_id: 'artifact-put-1',
    });
    expect(artifact.content_address).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect((await service.put({
      principal, account_id: 'acct_01', organization_id: 'org_01', workspace_id: 'cws_01', name: 'result.json', media_type: 'application/json',
      bytes: new TextEncoder().encode('{"ok":true}'), actor, request_id: 'artifact-put-1',
    })).id).toBe(artifact.id);
    await expect(service.put({
      principal, account_id: 'acct_01', organization_id: 'org_01', workspace_id: 'cws_01', name: 'different.json', media_type: 'application/json',
      bytes: new TextEncoder().encode('{"ok":false}'), actor, request_id: 'artifact-put-1',
    })).rejects.toMatchObject({ code: 'commercial.artifact.idempotency_reused' });
    expect(adapter).toBeInstanceOf(LocalTestArtifactAdapter);
    expect((adapter as LocalTestArtifactAdapter).hasObject(artifact.object_ref)).toBe(true);
    await expect(service.issueDownload({ principal, organization_id: 'org_01', workspace_id: 'cws_01', artifact_id: artifact.id, expires_at: '2026-08-11T13:00:00.000Z', actor, request_id: 'artifact-download-1' })).resolves.toMatchObject({ url: expect.stringContaining('test-download') });
    await expect(service.issueDownload({ principal, organization_id: 'org_02', workspace_id: 'cws_01', artifact_id: artifact.id, expires_at: '2026-08-11T13:00:00.000Z', actor, request_id: 'artifact-cross-tenant' })).rejects.toMatchObject({ code: 'commercial.artifact.not_found' });
  });

  it('blocks deletion under legal hold and applies retention deletion when no hold exists', async () => {
    const { service, store } = await createArtifacts();
    const holdArtifact = await service.put({ principal, account_id: 'acct_01', organization_id: 'org_01', workspace_id: 'cws_01', name: 'held.txt', media_type: 'text/plain', bytes: new Uint8Array([1]), actor, request_id: 'artifact-held-put' });
    await service.createLegalHold({ account_id: 'acct_01', organization_id: 'org_01', artifact_ids: [holdArtifact.id], reason: 'preserve for review', actor, request_id: 'hold-1' });
    await expect(service.delete({ principal, organization_id: 'org_01', workspace_id: 'cws_01', artifact_id: holdArtifact.id, actor, request_id: 'held-delete' })).rejects.toMatchObject({ code: 'commercial.artifact.legal_hold' });

    const policy = await service.createRetentionPolicy({ account_id: 'acct_01', organization_id: 'org_01', workspace_id: 'cws_01', retention_days: 0, delete_after_expiry: true, actor, request_id: 'retention-1' });
    const expiring = await service.put({ principal, account_id: 'acct_01', organization_id: 'org_01', workspace_id: 'cws_01', name: 'expire.txt', media_type: 'text/plain', bytes: new Uint8Array([2]), retention_policy_id: policy.id, actor, request_id: 'artifact-expire-put' });
    const deleted = await service.expire(now);
    expect(deleted.map((artifact) => artifact.id)).toContain(expiring.id);
    expect((await store.get('hosted_artifacts', expiring.id))?.state).toBe('deleted');
  });

  it('does not claim hosted storage when the adapter is unavailable', async () => {
    const { service } = await createArtifacts(new UnavailableArtifactAdapter());
    await expect(service.put({ principal, account_id: 'acct_01', organization_id: 'org_01', workspace_id: 'cws_01', name: 'blocked', media_type: 'text/plain', bytes: new Uint8Array([1]), actor, request_id: 'artifact-unavailable' })).rejects.toMatchObject({ code: 'commercial.hosted_artifacts.not_configured' });
  });
});
