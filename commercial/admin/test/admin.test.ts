import { describe, expect, it } from 'vitest';

import {
  InMemoryAuditWriter,
  InMemoryCommercialStore,
  MonotonicIdGenerator,
  DeterministicTokenGenerator,
} from '../../adapters/src/index';
import { CommercialEntitlementService } from '@spiderbyte/commercial-billing';
import {
  CommercialAdminService,
  UnavailableWebhookDeliveryAdapter,
  type WebhookDeliveryAdapter,
} from '@spiderbyte/commercial-admin';
import { capabilityStatusSchema, principalSchema } from '@spiderbyte/commercial-domain';

const now = '2026-08-11T12:00:00.000Z';
const actor = { kind: 'system' as const, id: 'admin-test' };
const principal = principalSchema.parse({
  subject_id: 'usr_admin', account_id: 'acct_01', user_id: 'usr_admin', session_id: 'ses_admin', organization_ids: ['org_01'],
  scopes: ['organization.manage', 'member.manage', 'policy.manage', 'audit.read', 'support.grant'], auth_method: 'session',
  issued_at: now, expires_at: '2026-08-12T12:00:00.000Z',
});

class TestWebhookDeliveryAdapter implements WebhookDeliveryAdapter {
  capability() {
    return capabilityStatusSchema.parse({ capability: 'webhooks', availability: 'available', adapter: 'test-webhooks', reason: 'test', checked_at: now });
  }

  async deliver() {
    return { delivered: true, response_code: 200 };
  }
}

async function createAdmin(webhookDelivery: WebhookDeliveryAdapter = new TestWebhookDeliveryAdapter()) {
  const store = new InMemoryCommercialStore();
  const audit = new InMemoryAuditWriter();
  const clock = { now: () => now };
  const ids = new MonotonicIdGenerator();
  const entitlement = new CommercialEntitlementService({ store, clock, ids, audit });
  const plans = await entitlement.seedDefaultPlans('acct_01', actor);
  await entitlement.changeSubscription({ account_id: 'acct_01', organization_id: 'org_01', plan_id: plans[0]!.id, actor, request_id: 'admin-subscription' });
  for (const key of ['advanced_rbac', 'service_accounts', 'webhooks']) {
    await entitlement.setEntitlement({ account_id: 'acct_01', organization_id: 'org_01', key, status: 'included', value: true, source: 'override', actor, request_id: `admin-entitlement-${key}` });
  }
  const admin = new CommercialAdminService({
    store,
    entitlement,
    authorize: { authorize: async () => undefined },
    clock,
    ids,
    tokens: new DeterministicTokenGenerator(),
    audit,
    auditReader: audit,
    webhookDelivery,
  });
  return { admin, store, audit };
}

describe('Team and Business administration', () => {
  it('creates custom RBAC, teams, groups, service accounts, and rotated hashed API keys', async () => {
    const { admin, store } = await createAdmin();
    const role = await admin.createCustomRole({ principal, account_id: 'acct_01', organization_id: 'org_01', name: 'Data operator', permission_keys: ['workspace.read', 'artifact.read'], actor, request_id: 'role-1' });
    expect(role.kind).toBe('custom');
    expect((await admin.createCustomRole({ principal, account_id: 'acct_01', organization_id: 'org_01', name: 'Data operator', permission_keys: ['workspace.read', 'artifact.read'], actor, request_id: 'role-1' })).id).toBe(role.id);
    await expect(admin.createCustomRole({ principal, account_id: 'acct_01', organization_id: 'org_01', name: 'Different role', permission_keys: ['workspace.read'], actor, request_id: 'role-1' })).rejects.toMatchObject({ code: 'commercial.admin.idempotency_reused' });
    const team = await admin.createTeam({ principal, account_id: 'acct_01', organization_id: 'org_01', name: 'Data', actor, request_id: 'team-1' });
    expect((await admin.createTeam({ principal, account_id: 'acct_01', organization_id: 'org_01', name: 'Data', actor, request_id: 'team-1' })).id).toBe(team.id);
    const group = await admin.createGroup({ principal, account_id: 'acct_01', organization_id: 'org_01', name: 'Analysts', actor, request_id: 'group-1' });
    expect((await admin.addUserToGroup({ principal, organization_id: 'org_01', group_id: group.id, user_id: 'usr_admin', actor, request_id: 'group-member-1' })).member_user_ids).toContain('usr_admin');
    expect(team.name).toBe('Data');

    const service = await admin.createServiceAccount({ principal, account_id: 'acct_01', organization_id: 'org_01', name: 'automation', scopes: ['artifact.read'], actor, request_id: 'service-1' });
    expect(service.client_secret).toBeTruthy();
    expect(JSON.stringify(await store.list('service_accounts'))).not.toContain(service.client_secret);
    const key = await admin.createApiKey({ principal, account_id: 'acct_01', organization_id: 'org_01', service_account_id: service.service_account.id, name: 'automation key', scopes: ['artifact.read'], actor, request_id: 'key-1' });
    expect(key.api_key.key_hash).toMatch(/^[a-f0-9]{64}$/);
    const rotated = await admin.rotateApiKey({ principal, account_id: 'acct_01', organization_id: 'org_01', api_key_id: key.api_key.id, actor, request_id: 'key-rotate-1' });
    expect(rotated.api_key.rotated_from_id).toBe(key.api_key.id);
    expect((await store.get('api_keys', key.api_key.id))?.state).toBe('revoked');
  });

  it('requires explicit, expiring support grants and delivers webhook events idempotently', async () => {
    const { admin, store } = await createAdmin();
    const grant = await admin.grantSupportAccess({ principal, account_id: 'acct_01', organization_id: 'org_01', support_actor: { kind: 'support', id: 'support-agent' }, reason: 'debug request', scope: ['workspace.read'], expires_at: '2026-08-12T12:00:00.000Z', approved: false, actor, request_id: 'support-1' });
    expect(grant.state).toBe('pending_approval');
    expect((await admin.expireSupportAccess('2026-08-13T12:00:00.000Z'))[0]?.state).toBe('expired');

    const webhook = await admin.createWebhook({ principal, account_id: 'acct_01', organization_id: 'org_01', url: 'https://example.test/hooks', event_types: ['run.completed'], actor, request_id: 'webhook-1' });
    expect(webhook.secret).toBeTruthy();
    expect(JSON.stringify(await store.list('webhook_endpoints'))).not.toContain(webhook.secret);
    const first = await admin.deliverWebhook({ principal, organization_id: 'org_01', endpoint_id: webhook.endpoint.id, event_id: 'event-1', event_type: 'run.completed', payload: { status: 'succeeded' }, actor, request_id: 'webhook-delivery-1' });
    const replay = await admin.deliverWebhook({ principal, organization_id: 'org_01', endpoint_id: webhook.endpoint.id, event_id: 'event-1', event_type: 'run.completed', payload: { status: 'succeeded' }, actor, request_id: 'webhook-delivery-2' });
    expect(first.delivered).toBe(true);
    expect(replay.delivered).toBe(true);
    await expect(admin.deliverWebhook({ principal, organization_id: 'org_01', endpoint_id: webhook.endpoint.id, event_id: 'event-1', event_type: 'run.completed', payload: { status: 'different' }, actor, request_id: 'webhook-delivery-3' })).rejects.toMatchObject({ code: 'commercial.admin.idempotency_reused' });
  });

  it('does not claim production webhook delivery when no adapter is configured', async () => {
    const { admin } = await createAdmin(new UnavailableWebhookDeliveryAdapter());
    const webhook = await admin.createWebhook({ principal, account_id: 'acct_01', organization_id: 'org_01', url: 'https://example.test/hooks', event_types: ['run.completed'], actor, request_id: 'webhook-unavailable-1' });
    await expect(admin.deliverWebhook({ principal, organization_id: 'org_01', endpoint_id: webhook.endpoint.id, event_id: 'event-unavailable', event_type: 'run.completed', payload: {}, actor, request_id: 'webhook-unavailable-2' })).rejects.toMatchObject({ code: 'commercial.webhooks.not_configured' });
  });
});
