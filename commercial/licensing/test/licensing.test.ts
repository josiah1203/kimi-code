import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  actorRefSchema,
  membershipSchema,
  organizationSchema,
  principalSchema,
  roleSchema,
  userSchema,
  offlineLicenseSchema,
  type OfflineLicense,
  type Principal,
} from '@spiderbyte/commercial-domain';
import {
  InMemoryAuditWriter,
  InMemoryCommercialStore,
  LocalLicenseKeyResolver,
  MonotonicIdGenerator,
  UnavailableLicenseKeyResolver,
} from '../../adapters/src/index';

import {
  canonicalLicensePayload,
  OfflineLicenseService,
} from '../src/index';
import type { LicenseAuthorizationPort } from '@spiderbyte/commercial-ports';

const accountId = 'acct_license_test';
const organizationId = 'org_license_test';
const ownerId = 'usr_license_owner';
const memberId = 'usr_license_member';
const roleId = 'role_license_owner';
const now = { value: '2026-08-12T12:00:00.000Z' };

function actor() {
  return actorRefSchema.parse({ kind: 'system', id: 'license-test' });
}

function principal(): Principal {
  return principalSchema.parse({
    subject_id: ownerId,
    account_id: accountId,
    user_id: ownerId,
    organization_ids: [organizationId],
    scopes: ['license.manage', 'license.read', 'seat.manage'],
    auth_method: 'development',
    issued_at: now.value,
    expires_at: '2026-08-13T12:00:00.000Z',
  });
}

function createLicense(privateKey: KeyObject, overrides: Partial<OfflineLicense> = {}): OfflineLicense {
  const unsigned = offlineLicenseSchema.parse({
    id: 'license_test_v1',
    organization_id: organizationId,
    plan: 'business',
    seat_count: 1,
    enabled_capabilities: ['provider.use', 'hosted_compute'],
    issued_at: '2026-08-01T00:00:00.000Z',
    expires_at: '2026-08-20T00:00:00.000Z',
    grace_period_days: 3,
    license_version: 1,
    key_id: 'license-test-key',
    signature: 'placeholder-signature-that-is-replaced',
    ...overrides,
  });
  const signature = sign(null, Buffer.from(canonicalLicensePayload(unsigned)), privateKey).toString('base64url');
  return offlineLicenseSchema.parse({ ...unsigned, signature });
}

async function fixture(overrides: { readonly keyResolver?: LocalLicenseKeyResolver; readonly initialLicense?: OfflineLicense } = {}) {
  now.value = '2026-08-12T12:00:00.000Z';
  const store = new InMemoryCommercialStore();
  const audit = new InMemoryAuditWriter();
  const ids = new MonotonicIdGenerator();
  const clock = { now: () => now.value };
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const initialLicense = overrides.initialLicense ?? createLicense(privateKey);
  const keyResolver = overrides.keyResolver ?? new LocalLicenseKeyResolver({
    environment: 'test',
    keys: { 'license-test-key': publicKeyPem },
    clock,
  });
  const authorization: LicenseAuthorizationPort = {
    async assertAuthorized(candidate, organization, action) {
      if (candidate.account_id !== accountId || organization !== organizationId || !candidate.scopes.includes(action)) {
        throw new Error('authorization denied');
      }
    },
  };
  const organization = organizationSchema.parse({
    id: organizationId,
    account_id: accountId,
    owner_user_id: ownerId,
    name: 'License Test Organization',
    state: 'active',
    enforced_sso: false,
    version: 1,
    created_at: now.value,
    updated_at: now.value,
    created_by: actor(),
    updated_by: actor(),
  });
  const owner = userSchema.parse({
    id: ownerId,
    account_id: accountId,
    email: 'owner@license.example.test',
    display_name: 'License Owner',
    state: 'active',
    version: 1,
    created_at: now.value,
    updated_at: now.value,
    created_by: actor(),
    updated_by: actor(),
  });
  const member = userSchema.parse({
    id: memberId,
    account_id: accountId,
    email: 'member@license.example.test',
    display_name: 'License Member',
    state: 'active',
    version: 1,
    created_at: now.value,
    updated_at: now.value,
    created_by: actor(),
    updated_by: actor(),
  });
  const role = roleSchema.parse({
    id: roleId,
    account_id: accountId,
    organization_id: organizationId,
    name: 'owner',
    kind: 'system',
    permission_keys: ['license.manage', 'license.read', 'seat.manage'],
    state: 'active',
    version: 1,
    created_at: now.value,
    updated_at: now.value,
    created_by: actor(),
    updated_by: actor(),
  });
  const ownerMembership = membershipSchema.parse({
    id: 'mem_license_owner',
    account_id: accountId,
    organization_id: organizationId,
    user_id: ownerId,
    target: 'organization',
    role_ids: [roleId],
    state: 'active',
    joined_at: now.value,
    version: 1,
    created_at: now.value,
    updated_at: now.value,
    created_by: actor(),
    updated_by: actor(),
  });
  const memberMembership = membershipSchema.parse({
    ...ownerMembership,
    id: 'mem_license_member',
    user_id: memberId,
  });
  await store.put('organizations', organization.id, organization);
  await store.put('users', owner.id, owner);
  await store.put('users', member.id, member);
  await store.put('roles', role.id, role);
  await store.put('memberships', ownerMembership.id, ownerMembership);
  await store.put('memberships', memberMembership.id, memberMembership);
  const service = new OfflineLicenseService({ store, clock, ids, audit, keyResolver, authorization });
  return { service, store, audit, privateKey, keyResolver, license: initialLicense, authorization };
}

describe('signed offline commercial licensing', () => {
  it('verifies, activates, inspects, assigns, revokes, and audits seats without sending customer data to the resolver', async () => {
    const fixtureState = await fixture();
    const { service, store, audit, license } = fixtureState;
    const activated = await service.activate(principal(), { license, request_id: 'license-activate-1' });
    expect(activated.state).toBe('active');
    expect(await store.get('licenses', license.id)).toMatchObject({ id: license.id, signature: license.signature });
    expect(JSON.stringify(await store.list('licenses'))).not.toContain('private');

    const inspection = await service.inspect(principal(), organizationId, 'license-inspect-1');
    expect(inspection).toMatchObject({ state: 'active', active_seat_count: 0, available_seat_count: 1 });
    expect((await service.inspectEntitlement(principal(), organizationId, 'hosted_compute', 'license-entitlement-1')).enabled).toBe(true);
    await expect(service.assertCapability(principal(), organizationId, 'provider.use', 'license-capability-1')).resolves.toBeUndefined();
    await expect(service.assertCapability(principal(), organizationId, 'billing.manage', 'license-capability-2')).rejects.toMatchObject({ code: 'commercial.licensing.capability_not_included' });

    const seat = await service.assignSeat(principal(), { organization_id: organizationId, user_id: memberId, request_id: 'seat-assign-1' });
    expect(seat.state).toBe('active');
    await expect(service.assignSeat(principal(), { organization_id: organizationId, user_id: ownerId, request_id: 'seat-assign-2' })).rejects.toMatchObject({ code: 'commercial.licensing.seat_limit_reached' });
    const revoked = await service.revokeSeat(principal(), { organization_id: organizationId, seat_id: seat.id, request_id: 'seat-revoke-1' });
    expect(revoked.state).toBe('revoked');
    const revokedLicense = await service.revokeLicense(principal(), { organization_id: organizationId, license_id: license.id, request_id: 'license-revoke-1' });
    expect(revokedLicense.state).toBe('revoked');
    expect(await audit.verifyIntegrity()).toBe(true);
    expect(audit.list().map((event) => event.action)).toEqual(expect.arrayContaining(['license.activate', 'license.seat.assign', 'license.seat.revoke']));
  });

  it('rejects forged, cross-organization, deployment-mismatched, and idempotency-conflicting licenses', async () => {
    const fixtureState = await fixture();
    const { service, privateKey } = fixtureState;
    const forged = { ...fixtureState.license, plan: 'enterprise' };
    await expect(service.activate(principal(), { license: forged, request_id: 'license-forged-1' })).rejects.toMatchObject({ code: 'commercial.licensing.invalid_signature' });
    const otherOrganization = createLicense(privateKey, { id: 'license_other_org', organization_id: 'org_other_license' });
    await expect(service.activate(principal(), { license: otherOrganization, request_id: 'license-cross-org-1' })).rejects.toThrow();
    const restricted = createLicense(privateKey, {
      id: 'license_restricted',
      deployment_restrictions: { deployment_id: 'deployment-a' },
    });
    await expect(service.activate(principal(), { license: restricted, deployment: { deployment_id: 'deployment-b' }, request_id: 'license-deploy-1' })).rejects.toMatchObject({ code: 'commercial.licensing.deployment_mismatch' });

    await service.activate(principal(), { license: fixtureState.license, request_id: 'license-idempotent-1' });
    await expect(service.activate(principal(), { license: { ...fixtureState.license, id: 'license_different' }, request_id: 'license-idempotent-1' })).rejects.toMatchObject({ code: 'commercial.licensing.idempotency_reused' });
  });

  it('enters grace, expires after grace, and accepts a signed offline renewal', async () => {
    const fixtureState = await fixture();
    const { service, privateKey } = fixtureState;
    await service.activate(principal(), { license: fixtureState.license, request_id: 'license-grace-activate' });
    now.value = '2026-08-21T00:00:00.000Z';
    expect((await service.inspect(principal(), organizationId, 'license-grace-inspect')).state).toBe('grace');
    now.value = '2026-08-24T00:00:00.000Z';
    expect((await service.inspect(principal(), organizationId, 'license-expired-inspect')).state).toBe('expired');
    await expect(service.assignSeat(principal(), { organization_id: organizationId, user_id: memberId, request_id: 'license-expired-seat' })).rejects.toMatchObject({ code: 'commercial.licensing.expired' });
    const renewed = createLicense(privateKey, {
      id: 'license_test_v2',
      license_version: 2,
      issued_at: '2026-08-24T00:00:00.000Z',
      expires_at: '2026-09-24T00:00:00.000Z',
      seat_count: 2,
    });
    const renewal = await service.renew(principal(), { organization_id: organizationId, license: renewed, request_id: 'license-renew-1' });
    expect(renewal.license.license_version).toBe(2);
    expect((await service.inspect(principal(), organizationId, 'license-renew-inspect')).license.id).toBe('license_test_v2');
  });

  it('revokes the requested prior license after renewal without revoking the current activation', async () => {
    const fixtureState = await fixture();
    const { service, privateKey } = fixtureState;
    await service.activate(principal(), { license: fixtureState.license, request_id: 'license-revoke-old-activate' });
    const renewed = createLicense(privateKey, {
      id: 'license_test_v2_revoke',
      license_version: 2,
      issued_at: '2026-08-12T12:00:00.000Z',
      expires_at: '2026-09-12T12:00:00.000Z',
      seat_count: 2,
    });
    await service.renew(principal(), {
      organization_id: organizationId,
      license: renewed,
      request_id: 'license-revoke-renew',
    });

    const revokedPrior = await service.revokeLicense(principal(), {
      organization_id: organizationId,
      license_id: fixtureState.license.id,
      request_id: 'license-revoke-old',
    });

    expect(revokedPrior).toMatchObject({ license_id: fixtureState.license.id, state: 'revoked' });
    expect((await service.inspect(principal(), organizationId, 'license-revoke-current-inspect')).license.id).toBe(renewed.id);
  });

  it('fails closed when verification is unavailable before activation and supports cached inspection during temporary outage', async () => {
    const fixtureState = await fixture();
    const { service, license } = fixtureState;
    await service.activate(principal(), { license, request_id: 'license-cache-activate' });
    const unavailable = new UnavailableLicenseKeyResolver('temporarily_unavailable');
    const unavailableService = new OfflineLicenseService({
      store: fixtureState.store,
      clock: { now: () => now.value },
      ids: new MonotonicIdGenerator(),
      audit: fixtureState.audit,
      keyResolver: unavailable,
      authorization: fixtureState.authorization,
    });
    const coldFixture = await fixture();
    const coldService = new OfflineLicenseService({
      store: coldFixture.store,
      clock: { now: () => now.value },
      ids: new MonotonicIdGenerator(),
      audit: coldFixture.audit,
      keyResolver: unavailable,
      authorization: coldFixture.authorization,
    });
    await expect(coldService.activate(principal(), { license: coldFixture.license, request_id: 'license-cold-unavailable' })).rejects.toMatchObject({ code: 'commercial.licensing.verification_unavailable' });
    const cached = await unavailableService.inspect(principal(), organizationId, 'license-cache-inspect');
    expect(cached.state).toBe('active');
  });
});
