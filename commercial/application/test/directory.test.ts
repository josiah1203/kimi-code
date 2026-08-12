import { describe, expect, it } from 'vitest';

import {
  DeterministicTokenGenerator,
  DevelopmentIdentityAdapter,
  InMemoryAuditWriter,
  InMemoryCommercialStore,
  MonotonicIdGenerator,
} from '../../adapters/src/index';
import { CommercialApplicationCodes, CommercialApplicationError, CommercialDirectoryService } from '@spiderbyte/commercial-application';

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
});
