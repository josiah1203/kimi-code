import { describe, expect, it } from 'vitest';

import { capabilityStatusSchema, type Principal } from '@spiderbyte/commercial-domain';
import type { ExternalIdentityDirectoryPort, IdentityPort } from '@spiderbyte/commercial-ports';
import {
  DeterministicTokenGenerator,
  DevelopmentIdentityAdapter,
  InMemoryAuditWriter,
  InMemoryCommercialStore,
  MonotonicIdGenerator,
} from '../../adapters/src/index';
import { CommercialApplicationCodes, CommercialApplicationError, CommercialDirectoryService } from '@spiderbyte/commercial-application';

/**
 * Commercial directory contract scenarios use the real application service,
 * in-memory store, audit writer, and explicit development identity adapter;
 * no provider or network boundary is stubbed. Run with
 * `pnpm --filter @spiderbyte/commercial-application test`.
 */

const now = '2026-08-11T12:00:00.000Z';

function createDirectory() {
  const clock = { now: () => now };
  const store = new InMemoryCommercialStore();
  const audit = new InMemoryAuditWriter();
  const identity = new DevelopmentIdentityAdapter({
    environment: 'development',
    clock,
    tokenGenerator: new DeterministicTokenGenerator(),
  });
  return {
    store,
    audit,
    directory: new CommercialDirectoryService({
      store,
      audit,
      identity,
      clock,
      ids: new MonotonicIdGenerator(),
      tokens: new DeterministicTokenGenerator(),
    }),
  };
}

describe('commercial directory application', () => {
  it('creates an account, persists only hashed session material, and is idempotent', async () => {
    const { directory, store, audit } = createDirectory();
    const input = {
      request_id: 'account-request-1',
      actor: { kind: 'system' as const, id: 'test-system' },
      email: 'owner@example.test',
      display_name: 'Owner',
      secret: 'owner-development-secret',
    };
    const first = await directory.createAccount(input);
    const replay = await directory.createAccount(input);
    expect(replay.account.id).toBe(first.account.id);
    expect(JSON.stringify(await store.list('accounts'))).not.toContain(input.secret);
    expect(JSON.stringify(await store.list('users'))).not.toContain(input.secret);

    const principal = await directory.authenticate({ email: input.email, secret: input.secret });
    expect(principal?.user_id).toBe(first.user.id);
    const sessions = await store.list('sessions');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(sessions)).not.toContain(input.secret);
    expect(await audit.verifyIntegrity()).toBe(true);
  });

  it('creates an organization and workspace, denies a different tenant, and protects the last owner', async () => {
    const owner = createDirectory();
    const account = await owner.directory.createAccount({
      request_id: 'owner-account-1',
      actor: { kind: 'system', id: 'test-system' },
      email: 'owner@example.test',
      display_name: 'Owner',
      secret: 'owner-development-secret',
    });
    const principal = (await owner.directory.authenticate({
      email: 'owner@example.test',
      secret: 'owner-development-secret',
    }))!;
    const organization = await owner.directory.createOrganization(principal, {
      request_id: 'organization-request-1',
      actor: { kind: 'user', id: account.user.id },
      name: 'Example Organization',
    });
    const workspace = await owner.directory.createWorkspace(principal, {
      request_id: 'workspace-request-1',
      actor: { kind: 'user', id: account.user.id },
      organization_id: organization.id,
      name: 'Analysis',
      slug: 'analysis',
      region: 'local',
    });
    expect(workspace.state).toBe('provisioning');

    const other = createDirectory();
    await other.directory.createAccount({
      request_id: 'other-account-1',
      actor: { kind: 'system', id: 'test-system' },
      email: 'other@example.test',
      display_name: 'Other',
      secret: 'other-development-secret',
    });
    const otherPrincipal = (await other.directory.authenticate({
      email: 'other@example.test',
      secret: 'other-development-secret',
    }))!;
    await expect(other.directory.createWorkspace(otherPrincipal, {
      request_id: 'cross-tenant-workspace-1',
      actor: { kind: 'user', id: otherPrincipal.user_id! },
      organization_id: organization.id,
      name: 'No access',
      slug: 'no-access',
      region: 'local',
    })).rejects.toMatchObject({ code: CommercialApplicationCodes.ORGANIZATION_NOT_FOUND });

    const membership = (await owner.store.list('memberships'))[0]!;
    await expect(owner.directory.changeMembershipState(principal, {
      request_id: 'remove-owner-1',
      actor: { kind: 'user', id: account.user.id },
      membership_id: membership.id,
      state: 'removed',
    })).rejects.toMatchObject({ code: CommercialApplicationCodes.LAST_OWNER_REQUIRED });
    const memberRole = (await owner.store.list('roles')).find((candidate) => candidate.name === 'member')!;
    await expect(owner.directory.changeMembershipRoles(principal, {
      request_id: 'remove-owner-role-1',
      actor: { kind: 'user', id: account.user.id },
      organization_id: organization.id,
      membership_id: membership.id,
      role_ids: [memberRole.id],
    })).rejects.toMatchObject({ code: CommercialApplicationCodes.LAST_OWNER_REQUIRED });
  });

  it('does not persist invitation tokens and prevents secret replay', async () => {
    const { directory, store } = createDirectory();
    const account = await directory.createAccount({
      request_id: 'invite-owner-account-1',
      actor: { kind: 'system', id: 'test-system' },
      email: 'owner@example.test',
      display_name: 'Owner',
      secret: 'owner-development-secret',
    });
    const principal = (await directory.authenticate({ email: 'owner@example.test', secret: 'owner-development-secret' }))!;
    const organization = await directory.createOrganization(principal, {
      request_id: 'invite-organization-1',
      actor: { kind: 'user', id: account.user.id },
      name: 'Invites',
    });
    const role = (await store.list('roles')).find((candidate) => candidate.name === 'member')!;
    const invitation = await directory.inviteMember(principal, {
      request_id: 'invite-request-1',
      actor: { kind: 'user', id: account.user.id },
      organization_id: organization.id,
      email: 'member@example.test',
      role_ids: [role.id],
      expires_at: '2026-08-12T12:00:00.000Z',
    });
    expect(invitation.invitation_token).toBeTruthy();
    expect(JSON.stringify(await store.list('idempotency'))).not.toContain(invitation.invitation_token);
    await expect(directory.inviteMember(principal, {
      request_id: 'invite-request-1',
      actor: { kind: 'user', id: account.user.id },
      organization_id: organization.id,
      email: 'member@example.test',
      role_ids: [role.id],
      expires_at: '2026-08-12T12:00:00.000Z',
    })).rejects.toMatchObject({ code: CommercialApplicationCodes.IDEMPOTENCY_REPLAY_SECRET_UNAVAILABLE });
  });

  it('rejects idempotency-key reuse with a different command', async () => {
    const { directory } = createDirectory();
    const account = await directory.createAccount({
      request_id: 'same-request-1',
      actor: { kind: 'system', id: 'test-system' },
      email: 'owner@example.test',
      display_name: 'Owner',
      secret: 'owner-development-secret',
    });
    const principal = (await directory.authenticate({ email: 'owner@example.test', secret: 'owner-development-secret' }))!;
    await directory.createOrganization(principal, {
      request_id: 'same-organization-request',
      actor: { kind: 'user', id: account.user.id },
      name: 'First',
    });
    await expect(directory.createOrganization(principal, {
      request_id: 'same-organization-request',
      actor: { kind: 'user', id: account.user.id },
      name: 'Different',
    })).rejects.toBeInstanceOf(CommercialApplicationError);
  });

  it('synchronizes a trusted external organization into tenant records and replays idempotently', async () => {
    const { directory, store, audit } = createDirectory();
    const input = {
      request_id: 'external-sync-request-1',
      actor: { kind: 'system' as const, id: 'identity-sync' },
      snapshot: {
        provider: 'clerk',
        external_organization_id: 'org_external_1',
        account_id: 'acct_sync_01',
        organization_id: 'org_sync_01',
        name: 'Synced Organization',
        owner_user_id: 'usr_sync_owner',
        members: [
          { user_id: 'usr_sync_owner', email: 'owner@example.test', display_name: 'Owner', role: 'owner' as const, state: 'active' as const },
          { user_id: 'usr_sync_member', email: 'member@example.test', display_name: 'Member', role: 'member' as const, state: 'active' as const },
        ],
      },
    };

    const first = await directory.synchronizeExternalOrganization(input);
    const replay = await directory.synchronizeExternalOrganization(input);

    expect(first.organization).toMatchObject({ id: 'org_sync_01', owner_user_id: 'usr_sync_owner' });
    expect(first.users).toHaveLength(2);
    expect(first.memberships).toHaveLength(2);
    expect(replay).toEqual(first);
    expect(await store.list('organizations')).toHaveLength(1);
    expect(await store.list('memberships')).toHaveLength(2);
    expect(await audit.verifyIntegrity()).toBe(true);
  });

  it('removes an organization membership omitted by a complete external snapshot', async () => {
    const { directory, store } = createDirectory();
    const base = {
      provider: 'clerk',
      external_organization_id: 'org_external_2',
      account_id: 'acct_sync_02',
      organization_id: 'org_sync_02',
      name: 'Membership Changes',
      owner_user_id: 'usr_sync_owner_2',
    } as const;
    await directory.synchronizeExternalOrganization({
      request_id: 'external-sync-request-2a',
      actor: { kind: 'system', id: 'identity-sync' },
      snapshot: {
        ...base,
        members: [
          { user_id: 'usr_sync_owner_2', email: 'owner2@example.test', display_name: 'Owner Two', role: 'owner', state: 'active' },
          { user_id: 'usr_sync_member_2', email: 'member2@example.test', display_name: 'Member Two', role: 'member', state: 'active' },
        ],
      },
    });

    await directory.synchronizeExternalOrganization({
      request_id: 'external-sync-request-2b',
      actor: { kind: 'system', id: 'identity-sync' },
      snapshot: {
        ...base,
        members: [
          { user_id: 'usr_sync_owner_2', email: 'owner2@example.test', display_name: 'Owner Two', role: 'owner', state: 'active' },
        ],
      },
    });

    const removed = (await store.list('memberships')).find((membership) => membership.user_id === 'usr_sync_member_2');
    expect(removed).toMatchObject({ state: 'removed' });
  });

  it('provisions a verified external session before commercial authorization', async () => {
    const snapshot = {
      provider: 'clerk',
      external_organization_id: 'org_external_session',
      account_id: 'acct_sync_session',
      organization_id: 'org_sync_session',
      name: 'Session Organization',
      owner_user_id: 'usr_sync_session_owner',
      members: [
        {
          user_id: 'usr_sync_session_owner',
          email: 'session-owner@example.test',
          display_name: 'Session Owner',
          role: 'owner' as const,
          state: 'active' as const,
        },
      ],
    };
    const principal: Principal = {
      subject_id: 'sub_sync_session',
      account_id: snapshot.account_id,
      user_id: snapshot.owner_user_id,
      session_id: 'ses_sync_session',
      organization_ids: [snapshot.organization_id],
      scopes: ['identity:read', 'organization.read'],
      auth_method: 'session',
      issued_at: now,
      expires_at: '2026-08-12T12:00:00.000Z',
    };
    const identity: IdentityPort & ExternalIdentityDirectoryPort = {
      adapter_name: 'test-external-identity',
      capability: () => capabilityStatusSchema.parse({
        capability: 'identity',
        availability: 'available',
        adapter: 'test-external-identity',
        reason: 'test identity provider',
        checked_at: now,
      }),
      register: async (input) => ({ provider_subject: input.user_id, auth_method: 'oidc' }),
      authenticate: async () => undefined,
      validateSession: async () => principal,
      revokeSession: async () => undefined,
      getOrganizationSnapshot: async () => snapshot,
      listOrganizationSnapshots: async () => [snapshot],
    };
    const base = createDirectory();
    const directory = new CommercialDirectoryService({
      store: base.store,
      audit: base.audit,
      identity,
      clock: { now: () => now },
      ids: new MonotonicIdGenerator(),
      tokens: new DeterministicTokenGenerator(),
    });

    const first = await directory.validateSession('external-session-token');
    const second = await directory.validateSession('external-session-token');

    expect(first).toEqual(principal);
    expect(second).toEqual(principal);
    expect(await base.store.list('organizations')).toHaveLength(1);
    expect(await base.store.list('memberships')).toHaveLength(1);
    expect(await base.store.list('sessions')).toMatchObject([
      { id: principal.session_id, account_id: principal.account_id, user_id: principal.user_id, state: 'active' },
    ]);
    expect(JSON.stringify(await base.store.list('sessions'))).not.toContain('external-session-token');
  });

  it('fails closed when an external directory returns a snapshot for another account', async () => {
    const snapshot = {
      provider: 'clerk',
      external_organization_id: 'org_external_mismatch',
      account_id: 'acct_other_account',
      organization_id: 'org_other_account',
      name: 'Other Account',
      owner_user_id: 'usr_other_owner',
      members: [
        {
          user_id: 'usr_other_owner',
          email: 'other-owner@example.test',
          display_name: 'Other Owner',
          role: 'owner' as const,
          state: 'active' as const,
        },
      ],
    };
    const principal: Principal = {
      subject_id: 'sub_sync_mismatch',
      account_id: 'acct_expected_account',
      user_id: 'usr_expected_owner',
      organization_ids: ['org_expected_account'],
      scopes: ['identity:read'],
      auth_method: 'session',
      issued_at: now,
      expires_at: '2026-08-12T12:00:00.000Z',
    };
    const identity: IdentityPort & ExternalIdentityDirectoryPort = {
      adapter_name: 'test-external-identity',
      capability: () => capabilityStatusSchema.parse({
        capability: 'identity',
        availability: 'available',
        adapter: 'test-external-identity',
        reason: 'test identity provider',
        checked_at: now,
      }),
      register: async (input) => ({ provider_subject: input.user_id, auth_method: 'oidc' }),
      authenticate: async () => undefined,
      validateSession: async () => principal,
      revokeSession: async () => undefined,
      getOrganizationSnapshot: async () => snapshot,
      listOrganizationSnapshots: async () => [snapshot],
    };
    const base = createDirectory();
    const directory = new CommercialDirectoryService({
      store: base.store,
      audit: base.audit,
      identity,
      clock: { now: () => now },
      ids: new MonotonicIdGenerator(),
      tokens: new DeterministicTokenGenerator(),
    });

    expect(await directory.validateSession('mismatched-session-token')).toBeUndefined();
    expect(await base.store.list('organizations')).toHaveLength(0);
    expect(await base.store.list('sessions')).toHaveLength(0);
  });
});
