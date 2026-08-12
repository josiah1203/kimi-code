import { createHash } from 'node:crypto';

import {
  COMMERCIAL_ACTIONS,
  accountSchema,
  actorRefSchema,
  assertSafeMetadata,
  authorizationDecisionSchema,
  capabilityStatusSchema,
  createAccountInputSchema,
  createWorkspaceInputSchema,
  createOrganizationInputSchema,
  invitationSchema,
  membershipSchema,
  organizationSchema,
  principalSchema,
  roleSchema,
  userSchema,
  workspaceSchema,
  acceptInvitationInputSchema,
  inviteMemberInputSchema,
  membershipStateInputSchema,
  type Account,
  type AcceptInvitationInput,
  type AuthorizationDecision,
  type CreateAccountInput,
  type CreateOrganizationInput,
  type CreateWorkspaceInput,
  type InviteMemberInput,
  type Invitation,
  type Membership,
  type MembershipStateInput,
  type Organization,
  type Principal,
  type User,
  type Workspace,
} from '@spiderbyte/commercial-domain';
import {
  CapabilityUnavailableError,
  type AuditWriter,
  type Clock,
  type CommercialStore,
  type IdentityPort,
  type IdGenerator,
  type TokenGenerator,
} from '@spiderbyte/commercial-ports';
import { CommercialApplicationCodes, CommercialApplicationError } from './errors';

export interface AccountRegistrationResult {
  readonly account: Account;
  readonly user: User;
  readonly provider_subject: string;
  readonly auth_method: 'oidc' | 'saml' | 'password' | 'development';
}

export interface InvitationResult {
  readonly invitation: Invitation;
  /** Returned once; only the hash is stored in the invitation record. */
  readonly invitation_token: string;
}

export interface CommercialDirectoryDependencies {
  readonly store: CommercialStore;
  readonly identity: IdentityPort;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly tokens: TokenGenerator;
  readonly audit: AuditWriter;
}

const OWNER_PERMISSIONS = [...COMMERCIAL_ACTIONS];
const ADMIN_PERMISSIONS = COMMERCIAL_ACTIONS.filter((action) => action !== 'support.grant');
const MEMBER_PERMISSIONS = [
  'organization.read',
  'workspace.read',
  'member.read',
  'usage.read',
  'artifact.read',
  'provider.use',
] as const;
const VIEWER_PERMISSIONS = ['organization.read', 'workspace.read', 'member.read', 'usage.read'] as const;

export class CommercialDirectoryService {
  constructor(private readonly deps: CommercialDirectoryDependencies) {}

  capabilityStatus() {
    return capabilityStatusSchema.parse(this.deps.identity.capability());
  }

  async createAccount(input: CreateAccountInput): Promise<AccountRegistrationResult> {
    const command = createAccountInputSchema.parse(input);
    const fingerprint = hashJson({
      request_id: command.request_id,
      email: command.email,
      display_name: command.display_name,
    });
    const replay = await this.replay<AccountRegistrationResult>('account.create', command.request_id, fingerprint);
    if (replay !== undefined) return replay;
    this.requireIdentity();

    return this.deps.store.transaction(async (store) => {
      const duplicate = await store.list('users');
      if (duplicate.some((user) => user.email === command.email)) {
        throw new CommercialApplicationError(
          CommercialApplicationCodes.INVALID_STATE,
          'an account already exists for this email',
        );
      }
      const now = this.deps.clock.now();
      const accountId = this.deps.ids.next('acct_');
      const userId = this.deps.ids.next('usr_');
      const actor = { kind: 'system' as const, id: 'commercial-identity' };
      const account = accountSchema.parse({
        id: accountId,
        state: 'active',
        display_name: command.display_name,
        primary_user_id: userId,
        version: 1,
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
      });
      const user = userSchema.parse({
        id: userId,
        account_id: accountId,
        email: command.email,
        display_name: command.display_name,
        state: 'active',
        version: 1,
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
      });
      const registration = await this.deps.identity.register({
        account_id: accountId,
        user_id: userId,
        email: user.email,
        display_name: user.display_name,
        secret: command.secret,
      });
      await store.put('accounts', account.id, account);
      await store.put('users', user.id, user);
      const result = {
        account,
        user,
        provider_subject: registration.provider_subject,
        auth_method: registration.auth_method,
      } satisfies AccountRegistrationResult;
      await this.remember(store, 'account.create', command.request_id, fingerprint, result);
      await this.writeAudit({
        account_id: account.id,
        actor,
        action: 'account.create',
        target_type: 'account',
        target_id: account.id,
        outcome: 'succeeded',
        request_id: command.request_id,
        occurred_at: now,
      });
      return result;
    });
  }

  async login(input: { readonly email: string; readonly secret: string }): Promise<{ readonly principal: Principal; readonly session_token: string; readonly expires_at: string } | undefined> {
    this.requireIdentity();
    const authentication = await this.deps.identity.authenticate(input);
    if (authentication === undefined) return undefined;
    const user = authentication.principal.user_id === undefined
      ? undefined
      : await this.deps.store.get('users', authentication.principal.user_id);
    if (user === undefined || user.state !== 'active') return undefined;
    const organizations = await this.deps.store.list('organizations');
    const principal = principalSchema.parse({
      ...authentication.principal,
      organization_ids: organizations
        .filter((organization) => organization.account_id === user.account_id && organization.state === 'active')
        .map((organization) => organization.id),
    });
    if (principal.session_id === undefined) {
      throw new CommercialApplicationError(
        CommercialApplicationCodes.INVALID_STATE,
        'identity adapter returned an authentication without a session identifier',
      );
    }
    const now = this.deps.clock.now();
    const actor = actorRefSchema.parse({ kind: 'user', id: user.id });
    const session = {
      id: principal.session_id,
      account_id: user.account_id,
      user_id: user.id,
      token_hash: hashToken(authentication.session_token),
      organization_id: undefined,
      state: 'active' as const,
      auth_method: principal.auth_method === 'development' ? 'development' as const : 'session' as const,
      scopes: principal.scopes,
      issued_at: principal.issued_at,
      expires_at: principal.expires_at,
      last_seen_at: now,
      version: 1,
      created_at: now,
      updated_at: now,
      created_by: actor,
      updated_by: actor,
    };
    await this.deps.store.put('sessions', session.id, session);
    await this.deps.store.put('users', user.id, {
      ...user,
      last_authenticated_at: now,
      version: user.version + 1,
      updated_at: now,
      updated_by: actor,
    });
    return {
      principal,
      session_token: authentication.session_token,
      expires_at: authentication.expires_at,
    };
  }

  async authenticate(input: { readonly email: string; readonly secret: string }): Promise<Principal | undefined> {
    return (await this.login(input))?.principal;
  }

  async validateSession(token: string): Promise<Principal | undefined> {
    this.requireIdentity();
    const principal = await this.deps.identity.validateSession(token);
    if (principal === undefined) return undefined;
    if (Date.parse(principal.expires_at) <= Date.parse(this.deps.clock.now())) return undefined;
    if (principal.user_id !== undefined) {
      const user = await this.deps.store.get('users', principal.user_id);
      if (user === undefined || user.state !== 'active') return undefined;
    }
    if (principal.session_id !== undefined) {
      const session = await this.deps.store.get('sessions', principal.session_id);
      if (session === undefined || session.state !== 'active' || session.token_hash !== hashToken(token)) return undefined;
      const now = this.deps.clock.now();
      await this.deps.store.put('sessions', session.id, {
        ...session,
        last_seen_at: now,
        updated_at: now,
        updated_by: actorForPrincipal(principal),
        version: session.version + 1,
      });
    }
    return principal;
  }

  async revokeSession(principal: Principal, sessionId: string, requestId: string): Promise<void> {
    this.requireUser(principal);
    const session = await this.deps.store.get('sessions', sessionId);
    if (session === undefined || session.account_id !== principal.account_id || session.user_id !== principal.user_id) {
      throw new CommercialApplicationError(CommercialApplicationCodes.AUTHORIZATION_DENIED, 'session is not owned by principal');
    }
    await this.deps.identity.revokeSession(sessionId);
    const now = this.deps.clock.now();
    const actor = actorForPrincipal(principal);
    await this.deps.store.put('sessions', session.id, {
      ...session,
      state: 'revoked',
      revoked_at: now,
      updated_at: now,
      updated_by: actor,
      version: session.version + 1,
    });
    await this.writeAudit({
      account_id: session.account_id,
      actor,
      action: 'session.revoke',
      target_type: 'session',
      target_id: session.id,
      outcome: 'succeeded',
      request_id: requestId,
      occurred_at: now,
    });
  }

  async createOrganization(principal: Principal, input: CreateOrganizationInput): Promise<Organization> {
    const command = createOrganizationInputSchema.parse(input);
    this.requireUser(principal);
    const user = await this.requireUserRecord(principal);
    const fingerprint = hashJson({ request_id: command.request_id, name: command.name });
    const replay = await this.replay<Organization>('organization.create', command.request_id, fingerprint);
    if (replay !== undefined) return replay;

    return this.deps.store.transaction(async (store) => {
      const now = this.deps.clock.now();
      const organizationId = this.deps.ids.next('org_');
      const actor = actorForPrincipal(principal);
      const organization = organizationSchema.parse({
        id: organizationId,
        account_id: user.account_id,
        owner_user_id: user.id,
        name: command.name,
        state: 'active',
        enforced_sso: false,
        version: 1,
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
      });
      const roles = await this.createSystemRoles(store, user.account_id, organization.id, actor, now);
      const membership = membershipSchema.parse({
        id: this.deps.ids.next('mem_'),
        account_id: user.account_id,
        organization_id: organization.id,
        user_id: user.id,
        target: 'organization',
        role_ids: [roles.owner.id],
        state: 'active',
        joined_at: now,
        version: 1,
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
      });
      await store.put('organizations', organization.id, organization);
      await store.put('memberships', membership.id, membership);
      await this.remember(store, 'organization.create', command.request_id, fingerprint, organization);
      await this.writeAudit({
        account_id: user.account_id,
        organization_id: organization.id,
        actor,
        action: 'organization.create',
        target_type: 'organization',
        target_id: organization.id,
        outcome: 'succeeded',
        request_id: command.request_id,
        occurred_at: now,
      });
      return organization;
    });
  }

  async createWorkspace(principal: Principal, input: CreateWorkspaceInput): Promise<Workspace> {
    const command = createWorkspaceInputSchema.parse(input);
    const organization = await this.requireOrganization(command.organization_id);
    await this.assertAuthorized(principal, organization.id, 'workspace.manage', command.request_id);
    const fingerprint = hashJson({ request_id: command.request_id, name: command.name, slug: command.slug });
    const replay = await this.replay<Workspace>('workspace.create', command.request_id, fingerprint);
    if (replay !== undefined) return replay;

    return this.deps.store.transaction(async (store) => {
      const existing = (await store.list('workspaces')).find(
        (workspace) => workspace.organization_id === organization.id && workspace.slug === command.slug,
      );
      if (existing !== undefined) {
        throw new CommercialApplicationError(CommercialApplicationCodes.INVALID_STATE, 'workspace slug is already in use');
      }
      const now = this.deps.clock.now();
      const actor = actorForPrincipal(principal);
      const workspace = workspaceSchema.parse({
        id: this.deps.ids.next('cws_'),
        account_id: organization.account_id,
        organization_id: organization.id,
        name: command.name,
        slug: command.slug,
        region: command.region,
        local_workspace_id: command.local_workspace_id,
        state: 'provisioning',
        version: 1,
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
      });
      await store.put('workspaces', workspace.id, workspace);
      await this.remember(store, 'workspace.create', command.request_id, fingerprint, workspace);
      await this.writeAudit({
        account_id: organization.account_id,
        organization_id: organization.id,
        workspace_id: workspace.id,
        actor,
        action: 'workspace.create',
        target_type: 'workspace',
        target_id: workspace.id,
        outcome: 'succeeded',
        request_id: command.request_id,
        occurred_at: now,
      });
      return workspace;
    });
  }

  async transferOrganizationOwnership(principal: Principal, input: {
    readonly organization_id: string;
    readonly new_owner_user_id: string;
    readonly request_id: string;
  }): Promise<Organization> {
    const organization = await this.requireOrganization(input.organization_id);
    await this.assertAuthorized(principal, organization.id, 'organization.manage', input.request_id);
    const newOwner = await this.deps.store.get('users', input.new_owner_user_id);
    if (newOwner === undefined || newOwner.account_id !== organization.account_id || newOwner.state !== 'active') {
      throw new CommercialApplicationError(CommercialApplicationCodes.USER_NOT_FOUND, 'new owner is not an active user in the account');
    }
    const memberships = await this.deps.store.list('memberships');
    const targetMembership = memberships.find((membership) =>
      membership.organization_id === organization.id && membership.user_id === newOwner.id && membership.state === 'active',
    );
    if (targetMembership === undefined) {
      throw new CommercialApplicationError(CommercialApplicationCodes.AUTHORIZATION_DENIED, 'new owner must already be an active organization member');
    }
    const ownerRole = (await this.deps.store.list('roles')).find((role) => role.organization_id === organization.id && role.name === 'owner' && role.state === 'active');
    if (ownerRole === undefined) throw new CommercialApplicationError(CommercialApplicationCodes.INVALID_STATE, 'organization owner role is missing');
    const adminRole = (await this.deps.store.list('roles')).find((role) => role.organization_id === organization.id && role.name === 'admin' && role.state === 'active');
    const currentMembership = memberships.find((membership) => membership.organization_id === organization.id && membership.user_id === organization.owner_user_id && membership.state === 'active');
    const now = this.deps.clock.now();
    const actor = actorForPrincipal(principal);
    const updatedOrganization = organizationSchema.parse({ ...organization, owner_user_id: newOwner.id, version: organization.version + 1, updated_at: now, updated_by: actor });
    const updatedTarget = membershipSchema.parse({ ...targetMembership, role_ids: [...new Set([...targetMembership.role_ids, ownerRole.id])], version: targetMembership.version + 1, updated_at: now, updated_by: actor });
    await this.deps.store.transaction(async (store) => {
      await store.put('organizations', updatedOrganization.id, updatedOrganization);
      await store.put('memberships', updatedTarget.id, updatedTarget);
      if (currentMembership !== undefined && currentMembership.id !== targetMembership.id) {
        const oldRoles = currentMembership.role_ids.filter((roleId) => roleId !== ownerRole.id);
        await store.put('memberships', currentMembership.id, membershipSchema.parse({ ...currentMembership, role_ids: oldRoles.length > 0 ? oldRoles : [adminRole?.id ?? ownerRole.id], version: currentMembership.version + 1, updated_at: now, updated_by: actor }));
      }
      await this.writeAudit({ account_id: organization.account_id, organization_id: organization.id, actor, action: 'organization.ownership_transfer', target_type: 'organization', target_id: organization.id, outcome: 'succeeded', request_id: input.request_id, occurred_at: now, detail: { previous_owner_user_id: organization.owner_user_id, new_owner_user_id: newOwner.id } });
    });
    return updatedOrganization;
  }

  async inviteMember(principal: Principal, input: InviteMemberInput): Promise<InvitationResult> {
    const command = inviteMemberInputSchema.parse(input);
    const organization = await this.requireOrganization(command.organization_id);
    await this.assertAuthorized(principal, organization.id, 'member.manage', command.request_id);
    if (Date.parse(command.expires_at) <= Date.parse(this.deps.clock.now())) {
      throw new CommercialApplicationError(CommercialApplicationCodes.INVALID_STATE, 'invitation must expire in the future');
    }
    const fingerprint = hashJson({
      request_id: command.request_id,
      email: command.email,
      role_ids: command.role_ids,
      workspace_id: command.workspace_id,
      team_id: command.team_id,
      expires_at: command.expires_at,
    });
    const replay = await this.replay<Partial<InvitationResult>>('invitation.create', command.request_id, fingerprint);
    if (replay !== undefined) {
      if (replay.invitation_token === undefined) {
        throw new CommercialApplicationError(
          CommercialApplicationCodes.IDEMPOTENCY_REPLAY_SECRET_UNAVAILABLE,
          'the invitation was already created; its one-time token is not stored and cannot be replayed',
        );
      }
      return replay as InvitationResult;
    }
    for (const roleId of command.role_ids) await this.requireRole(roleId, organization.id);
    if (command.workspace_id !== undefined) {
      const workspace = await this.requireWorkspace(command.workspace_id);
      if (workspace.organization_id !== organization.id) {
        throw new CommercialApplicationError(CommercialApplicationCodes.AUTHORIZATION_DENIED, 'workspace is outside organization');
      }
    }
    const token = this.deps.tokens.token(32);
    const now = this.deps.clock.now();
    const actor = actorForPrincipal(principal);
    const invitation = invitationSchema.parse({
      id: this.deps.ids.next('invite_'),
      account_id: organization.account_id,
      organization_id: organization.id,
      workspace_id: command.workspace_id,
      team_id: command.team_id,
      email: command.email,
      role_ids: command.role_ids,
      token_hash: hashToken(token),
      state: 'pending',
      expires_at: command.expires_at,
      version: 1,
      created_at: now,
      updated_at: now,
      created_by: actor,
      updated_by: actor,
    });
    const result = { invitation, invitation_token: token } satisfies InvitationResult;
    await this.deps.store.transaction(async (store) => {
      await store.put('invitations', invitation.id, invitation);
      // Invitation tokens are one-time secrets. Keep the idempotency record
      // replay-safe without persisting the token in the ordinary store.
      await this.remember(store, 'invitation.create', command.request_id, fingerprint, { invitation });
    });
    await this.writeAudit({
      account_id: organization.account_id,
      organization_id: organization.id,
      actor,
      action: 'invitation.create',
      target_type: 'invitation',
      target_id: invitation.id,
      outcome: 'succeeded',
      request_id: command.request_id,
      occurred_at: now,
      detail: { email: command.email, workspace_id: command.workspace_id },
    });
    return result;
  }

  async acceptInvitation(principal: Principal, input: AcceptInvitationInput): Promise<Membership> {
    const command = acceptInvitationInputSchema.parse(input);
    this.requireUser(principal);
    const user = await this.requireUserRecord(principal);
    const invitation = await this.deps.store.get('invitations', command.invitation_id);
    if (invitation === undefined) {
      throw new CommercialApplicationError(CommercialApplicationCodes.INVITATION_NOT_FOUND, 'invitation not found');
    }
    if (invitation.state !== 'pending' || Date.parse(invitation.expires_at) <= Date.parse(this.deps.clock.now())) {
      throw new CommercialApplicationError(CommercialApplicationCodes.INVITATION_EXPIRED, 'invitation is expired or no longer pending');
    }
    if (invitation.account_id !== user.account_id || invitation.email !== user.email || hashToken(command.token) !== invitation.token_hash) {
      throw new CommercialApplicationError(CommercialApplicationCodes.INVITATION_EMAIL_MISMATCH, 'invitation cannot be accepted by this user');
    }
    const fingerprint = hashJson({ request_id: command.request_id, invitation_id: invitation.id });
    const replay = await this.replay<Membership>('invitation.accept', command.request_id, fingerprint);
    if (replay !== undefined) return replay;
    const now = this.deps.clock.now();
    const actor = actorForPrincipal(principal);
    const membership = membershipSchema.parse({
      id: this.deps.ids.next('mem_'),
      account_id: invitation.account_id,
      organization_id: invitation.organization_id,
      user_id: user.id,
      workspace_id: invitation.workspace_id,
      team_id: invitation.team_id,
      target: invitation.workspace_id === undefined ? 'organization' : 'workspace',
      role_ids: invitation.role_ids,
      state: 'active',
      invited_at: invitation.created_at,
      joined_at: now,
      version: 1,
      created_at: now,
      updated_at: now,
      created_by: actor,
      updated_by: actor,
    });
    const accepted = invitationSchema.parse({
      ...invitation,
      state: 'accepted',
      accepted_by_user_id: user.id,
      accepted_at: now,
      updated_at: now,
      updated_by: actor,
      version: invitation.version + 1,
    });
    await this.deps.store.transaction(async (store) => {
      await store.put('memberships', membership.id, membership);
      await store.put('invitations', accepted.id, accepted);
      await this.remember(store, 'invitation.accept', command.request_id, fingerprint, membership);
    });
    await this.writeAudit({
      account_id: invitation.account_id,
      organization_id: invitation.organization_id,
      workspace_id: invitation.workspace_id,
      actor,
      action: 'invitation.accept',
      target_type: 'membership',
      target_id: membership.id,
      outcome: 'succeeded',
      request_id: command.request_id,
      occurred_at: now,
    });
    return membership;
  }

  async changeMembershipState(principal: Principal, input: MembershipStateInput): Promise<Membership> {
    const command = membershipStateInputSchema.parse(input);
    const membership = await this.deps.store.get('memberships', command.membership_id);
    if (membership === undefined) {
      throw new CommercialApplicationError(CommercialApplicationCodes.MEMBERSHIP_NOT_FOUND, 'membership not found');
    }
    await this.assertAuthorized(principal, membership.organization_id, 'member.manage', command.request_id);
    const roles = await Promise.all(membership.role_ids.map((roleId) => this.requireRole(roleId, membership.organization_id)));
    if (roles.some((role) => role.name === 'owner') && command.state !== 'active') {
      const owners = (await this.deps.store.list('memberships')).filter(
        (candidate) => candidate.organization_id === membership.organization_id && candidate.state === 'active',
      );
      const ownerCount = (await Promise.all(owners.map(async (candidate) => {
        const candidateRoles = await Promise.all(candidate.role_ids.map((roleId) => this.requireRole(roleId, candidate.organization_id)));
        return candidateRoles.some((role) => role.name === 'owner');
      }))).filter(Boolean).length;
      if (ownerCount <= 1) {
        throw new CommercialApplicationError(CommercialApplicationCodes.LAST_OWNER_REQUIRED, 'organization must retain an active owner');
      }
    }
    const actor = actorForPrincipal(principal);
    const updated = membershipSchema.parse({
      ...membership,
      state: command.state,
      removed_at: command.state === 'removed' ? this.deps.clock.now() : membership.removed_at,
      version: membership.version + 1,
      updated_at: this.deps.clock.now(),
      updated_by: actor,
    });
    const fingerprint = hashJson({ request_id: command.request_id, state: command.state, membership_id: membership.id });
    const replay = await this.replay<Membership>('membership.state', command.request_id, fingerprint);
    if (replay !== undefined) return replay;
    await this.deps.store.transaction(async (store) => {
      await store.put('memberships', updated.id, updated);
      await this.remember(store, 'membership.state', command.request_id, fingerprint, updated);
    });
    await this.writeAudit({
      account_id: membership.account_id,
      organization_id: membership.organization_id,
      workspace_id: membership.workspace_id,
      actor,
      action: 'membership.state',
      target_type: 'membership',
      target_id: membership.id,
      outcome: 'succeeded',
      request_id: command.request_id,
      occurred_at: updated.updated_at,
      detail: { state: command.state },
    });
    return updated;
  }

  async authorize(
    principal: Principal,
    organizationId: string,
    action: (typeof COMMERCIAL_ACTIONS)[number],
    requestId: string,
    workspaceId?: string,
  ): Promise<AuthorizationDecision> {
    const organization = await this.deps.store.get('organizations', organizationId);
    const actor = actorForPrincipal(principal);
    const evaluatedAt = this.deps.clock.now();
    if (organization === undefined || organization.account_id !== principal.account_id || organization.state !== 'active') {
      return authorizationDecisionSchema.parse({
        allowed: false,
        action,
        reason: 'organization is not available to this principal',
        account_id: principal.account_id,
        organization_id: organizationId,
        workspace_id: workspaceId,
        actor,
        evaluated_at: evaluatedAt,
      });
    }
    if (workspaceId !== undefined) {
      const workspace = await this.deps.store.get('workspaces', workspaceId);
      if (workspace === undefined || workspace.organization_id !== organization.id || workspace.state === 'archived') {
        return authorizationDecisionSchema.parse({
          allowed: false,
          action,
          reason: 'workspace is outside the organization or unavailable',
          account_id: principal.account_id,
          organization_id: organization.id,
          workspace_id: workspaceId,
          actor,
          evaluated_at: evaluatedAt,
        });
      }
    }
    const allowed = await this.hasPermission(principal, organization.id, action, workspaceId);
    return authorizationDecisionSchema.parse({
      allowed,
      action,
      reason: allowed ? 'permission granted by active membership and scope' : 'permission denied by default',
      account_id: principal.account_id,
      organization_id: organization.id,
      workspace_id: workspaceId,
      actor,
      evaluated_at: evaluatedAt,
    });
  }

  async assertAuthorized(
    principal: Principal,
    organizationId: string,
    action: (typeof COMMERCIAL_ACTIONS)[number],
    requestId: string,
    workspaceId?: string,
  ): Promise<void> {
    const decision = await this.authorize(principal, organizationId, action, requestId, workspaceId);
    await this.writeAudit({
      account_id: decision.account_id,
      organization_id: decision.organization_id,
      workspace_id: decision.workspace_id,
      actor: decision.actor,
      action: `authorization.${action}`,
      target_type: 'authorization',
      target_id: `${organizationId}:${workspaceId ?? '*'}`,
      outcome: decision.allowed ? 'allowed' : 'denied',
      request_id: requestId,
      occurred_at: decision.evaluated_at,
      detail: { reason: decision.reason },
    });
    if (!decision.allowed) {
      throw new CommercialApplicationError(CommercialApplicationCodes.AUTHORIZATION_DENIED, decision.reason, {
        action,
        organization_id: organizationId,
        workspace_id: workspaceId,
      });
    }
  }

  private async hasPermission(principal: Principal, organizationId: string, action: string, workspaceId?: string): Promise<boolean> {
    if (principal.account_id.length === 0) return false;
    if (principal.service_account_id !== undefined) {
      return principal.organization_ids.includes(organizationId) && principal.scopes.includes(action);
    }
    if (principal.user_id === undefined) return false;
    const memberships = (await this.deps.store.list('memberships')).filter((membership) =>
      membership.organization_id === organizationId && membership.user_id === principal.user_id && membership.state === 'active',
    );
    const applicable = memberships.filter((membership) =>
      membership.target === 'organization' || (workspaceId !== undefined && membership.workspace_id === workspaceId),
    );
    const roles = (await Promise.all(applicable.flatMap((membership) =>
      membership.role_ids.map((roleId) => this.deps.store.get('roles', roleId)),
    ))).filter((role): role is NonNullable<typeof role> => role !== undefined && role.state === 'active');
    return roles.some((role) => role.permission_keys.includes(action) || role.name === 'owner');
  }

  private async createSystemRoles(
    store: CommercialStore,
    accountId: string,
    organizationId: string,
    actor: ReturnType<typeof actorForPrincipal>,
    now: string,
  ) {
    const definitions = [
      { name: 'owner', permissions: OWNER_PERMISSIONS },
      { name: 'admin', permissions: ADMIN_PERMISSIONS },
      { name: 'member', permissions: MEMBER_PERMISSIONS },
      { name: 'viewer', permissions: VIEWER_PERMISSIONS },
    ] as const;
    const roles = [];
    for (const definition of definitions) {
      const role = roleSchema.parse({
        id: this.deps.ids.next('role_'),
        account_id: accountId,
        organization_id: organizationId,
        name: definition.name,
        kind: 'system',
        permission_keys: definition.permissions,
        state: 'active',
        version: 1,
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
      });
      await store.put('roles', role.id, role);
      roles.push(role);
    }
    return {
      owner: roles[0]!,
      admin: roles[1]!,
      member: roles[2]!,
      viewer: roles[3]!,
    };
  }

  private async requireOrganization(id: string): Promise<Organization> {
    const organization = await this.deps.store.get('organizations', id);
    if (organization === undefined) {
      throw new CommercialApplicationError(CommercialApplicationCodes.ORGANIZATION_NOT_FOUND, 'organization not found');
    }
    return organization;
  }

  private async requireWorkspace(id: string): Promise<Workspace> {
    const workspace = await this.deps.store.get('workspaces', id);
    if (workspace === undefined) {
      throw new CommercialApplicationError(CommercialApplicationCodes.WORKSPACE_NOT_FOUND, 'workspace not found');
    }
    return workspace;
  }

  private async requireRole(id: string, organizationId: string) {
    const role = await this.deps.store.get('roles', id);
    if (role === undefined || role.organization_id !== organizationId || role.state !== 'active') {
      throw new CommercialApplicationError(CommercialApplicationCodes.ROLE_NOT_FOUND, 'role is not active in this organization');
    }
    return role;
  }

  private async requireUserRecord(principal: Principal): Promise<User> {
    if (principal.user_id === undefined) {
      throw new CommercialApplicationError(CommercialApplicationCodes.AUTHENTICATION_REQUIRED, 'a user principal is required');
    }
    const user = await this.deps.store.get('users', principal.user_id);
    if (user === undefined || user.account_id !== principal.account_id || user.state !== 'active') {
      throw new CommercialApplicationError(CommercialApplicationCodes.USER_NOT_FOUND, 'active user was not found');
    }
    return user;
  }

  private requireUser(principal: Principal): void {
    if (principal.user_id === undefined) {
      throw new CommercialApplicationError(CommercialApplicationCodes.AUTHENTICATION_REQUIRED, 'a user principal is required');
    }
  }

  private requireIdentity(): void {
    const status = this.deps.identity.capability();
    if (status.availability !== 'available') throw new CapabilityUnavailableError(status);
  }

  private async replay<T>(scope: string, requestId: string, fingerprint: string): Promise<T | undefined> {
    const record = await this.deps.store.get('idempotency', `${scope}:${requestId}`);
    if (record === undefined) return undefined;
    if (record.fingerprint !== fingerprint) {
      throw new CommercialApplicationError(CommercialApplicationCodes.IDEMPOTENCY_REUSED, 'request id was reused with different input');
    }
    return JSON.parse(record.result_json) as T;
  }

  private async remember<T>(
    store: CommercialStore,
    scope: string,
    requestId: string,
    fingerprint: string,
    result: T,
  ): Promise<void> {
    await store.put('idempotency', `${scope}:${requestId}`, {
      scope,
      request_id: requestId,
      fingerprint,
      result_json: JSON.stringify(result),
      created_at: this.deps.clock.now(),
    });
  }

  private async writeAudit(input: Parameters<AuditWriter['append']>[0]): Promise<void> {
    assertSafeMetadata(input.detail);
    await this.deps.audit.append(input);
  }
}

function actorForPrincipal(principal: Principal) {
  if (principal.user_id !== undefined) return actorRefSchema.parse({ kind: 'user', id: principal.user_id });
  if (principal.service_account_id !== undefined) return actorRefSchema.parse({ kind: 'service_account', id: principal.service_account_id });
  return actorRefSchema.parse({ kind: 'system', id: principal.subject_id });
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
