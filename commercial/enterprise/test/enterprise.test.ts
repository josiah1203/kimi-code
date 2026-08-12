import { describe, expect, it } from 'vitest';

import {
  DeterministicTokenGenerator,
  InMemoryAuditWriter,
  InMemoryCommercialStore,
  LocalTestCustomerManagedKeyAdapter,
  LocalTestDomainVerificationAdapter,
  LocalTestEnterpriseIdentityAdapter,
  LocalTestPrivateNetworkAdapter,
  LocalTestScimAdapter,
  MonotonicIdGenerator,
  UnavailableCustomerManagedKeyAdapter,
  UnavailableEnterpriseIdentityAdapter,
} from '../../adapters/src/index';
import { CommercialEntitlementService } from '@spiderbyte/commercial-billing';
import { EnterpriseSecurityService } from '@spiderbyte/commercial-enterprise';
import { membershipSchema, userSchema, type Principal } from '@spiderbyte/commercial-domain';
import type {
  CustomerManagedKeyAdapter,
  DomainVerificationAdapter,
  EnterpriseIdentityAdapter,
  PrivateNetworkAdapter,
  ScimAdapter,
} from '@spiderbyte/commercial-ports';

const now = '2026-08-11T12:00:00.000Z';
const actor = { kind: 'system' as const, id: 'enterprise-test' };
const principal: Principal = {
  subject_id: 'usr_enterprise', account_id: 'acct_01', user_id: 'usr_enterprise', session_id: 'ses_enterprise', organization_ids: ['org_01'],
  scopes: ['enterprise.manage'], auth_method: 'session', issued_at: now, expires_at: '2026-08-12T12:00:00.000Z',
};

async function createEnterprise(adapters: {
  identity?: EnterpriseIdentityAdapter;
  scim?: ScimAdapter;
  domain?: DomainVerificationAdapter;
  kms?: CustomerManagedKeyAdapter;
  network?: PrivateNetworkAdapter;
} = {}) {
  const store = new InMemoryCommercialStore();
  const audit = new InMemoryAuditWriter();
  const clock = { now: () => now };
  const ids = new MonotonicIdGenerator();
  const entitlement = new CommercialEntitlementService({ store, clock, ids, audit });
  const plans = await entitlement.seedDefaultPlans('acct_01', actor);
  const enterprisePlan = plans.find((plan) => plan.edition === 'enterprise')!;
  await entitlement.changeSubscription({ account_id: 'acct_01', organization_id: 'org_01', plan_id: enterprisePlan.id, actor, request_id: 'enterprise-subscription' });
  for (const [key, requestId] of [['sso', 'enterprise-sso'], ['scim', 'enterprise-scim'], ['enterprise_configuration', 'enterprise-config']] as const) {
    await entitlement.setEntitlement({ account_id: 'acct_01', organization_id: 'org_01', key, status: 'included', value: true, source: 'contract', actor, request_id: requestId });
  }
  const service = new EnterpriseSecurityService({
    store,
    identity: adapters.identity ?? new LocalTestEnterpriseIdentityAdapter(),
    scim: adapters.scim ?? new LocalTestScimAdapter(),
    domainVerification: adapters.domain ?? new LocalTestDomainVerificationAdapter(),
    customerManagedKeys: adapters.kms ?? new LocalTestCustomerManagedKeyAdapter(),
    privateNetwork: adapters.network ?? new LocalTestPrivateNetworkAdapter(),
    entitlement,
    authorize: { authorize: async () => undefined },
    clock,
    ids,
    tokens: new DeterministicTokenGenerator(),
    audit,
  });
  return { service, store };
}

describe('enterprise identity and security contracts', () => {
  it('validates SSO, verifies domains, configures enforced policy, and runs SCIM lifecycle', async () => {
    const { service, store } = await createEnterprise();
    const provider = await service.configureIdentityProvider({ principal, account_id: 'acct_01', organization_id: 'org_01', type: 'oidc', issuer: 'https://idp.example.test', client_id: 'client', actor, request_id: 'idp-1' });
    expect(provider.production_ready).toBe(true);
    expect((await service.configureIdentityProvider({ principal, account_id: 'acct_01', organization_id: 'org_01', type: 'oidc', issuer: 'https://idp.example.test', client_id: 'client', actor, request_id: 'idp-1' })).provider.id).toBe(provider.provider.id);
    await expect(service.configureIdentityProvider({ principal, account_id: 'acct_01', organization_id: 'org_01', type: 'oidc', issuer: 'https://different.example.test', client_id: 'client', actor, request_id: 'idp-1' })).rejects.toMatchObject({ code: 'commercial.enterprise.idempotency_reused' });
    const issued = await service.issueDomainVerification({ principal, account_id: 'acct_01', organization_id: 'org_01', domain: 'example.test', actor, request_id: 'domain-1' });
    expect(issued.challenge?.method).toBe('dns_txt');
    const verified = await service.completeDomainVerification({ principal, organization_id: 'org_01', domain_id: issued.domain.id, token: issued.token!, actor, request_id: 'domain-2' });
    const configuration = await service.configureEnterprise({
      principal, account_id: 'acct_01', organization_id: 'org_01', identity_provider_id: provider.provider.id,
      verified_domain_ids: [verified.id], enforced_sso: true, group_role_mappings: { analysts: ['role_01'] }, mfa_required: true,
      deployment_mode: 'shared', release_channel: 'stable', actor, request_id: 'enterprise-config-1',
    });
    expect(configuration.enforced_sso).toBe(true);
    expect((await store.get('organizations', 'org_01'))).toBeUndefined();

    await store.put('users', 'usr_enterprise', userSchema.parse({
      id: 'usr_enterprise', account_id: 'acct_01', email: 'person@example.test', display_name: 'Person', state: 'active',
      version: 1, created_at: now, updated_at: now, created_by: actor, updated_by: actor,
    }));
    await store.put('memberships', 'mem_enterprise', membershipSchema.parse({
      id: 'mem_enterprise', account_id: 'acct_01', organization_id: 'org_01', user_id: 'usr_enterprise',
      target: 'organization', role_ids: ['role_enterprise'], state: 'active', joined_at: now,
      version: 1, created_at: now, updated_at: now, created_by: actor, updated_by: actor,
    }));
    await expect(service.provisionScimUser({ principal, organization_id: 'org_01', user_id: 'usr_enterprise', actor, request_id: 'scim-1' })).resolves.toMatchObject({ external_ref: expect.stringContaining('scim:') });
    await expect(service.syncScimGroups({ principal, organization_id: 'org_01', actor, request_id: 'scim-2' })).resolves.toMatchObject({ group_count: 0 });
  });

  it('reports unconfigured identity adapters without claiming production readiness', async () => {
    const { service, store } = await createEnterprise({ identity: new UnavailableEnterpriseIdentityAdapter() });
    const result = await service.configureIdentityProvider({ principal, account_id: 'acct_01', organization_id: 'org_01', type: 'saml', entity_id: 'https://idp.example.test/saml', actor, request_id: 'idp-unavailable' });
    expect(result.production_ready).toBe(false);
    expect(result.provider.state).toBe('draft');
    expect(result.capability.availability).toBe('not_configured');
    expect(await store.list('identity_providers')).toHaveLength(1);
  });

  it('fails closed for customer-managed keys until an adapter validates them', async () => {
    const { service } = await createEnterprise({ kms: new UnavailableCustomerManagedKeyAdapter() });
    await expect(service.configureEnterprise({ principal, account_id: 'acct_01', organization_id: 'org_01', enforced_sso: false, encryption_mode: 'customer_managed', kms_key_ref: 'kms_example', deployment_mode: 'shared', release_channel: 'stable', actor, request_id: 'kms-unavailable' })).rejects.toMatchObject({ code: 'commercial.customer_managed_keys.not_configured' });
  });
});
