import { createHash } from 'node:crypto';

import {
  COMMERCIAL_ACTIONS,
  apiKeySchema,
  assertSafeMetadata,
  createApiKeyInputSchema,
  groupSchema,
  organizationPolicySchema,
  roleSchema,
  serviceAccountSchema,
  supportAccessGrantSchema,
  teamSchema,
  webhookEndpointSchema,
  type ActorRef,
  type ApiKey,
  type CreateApiKeyInput,
  type Group,
  type OrganizationPolicy,
  type Principal,
  type Role,
  type ServiceAccount,
  type SupportAccessGrant,
  type Team,
  type WebhookEndpoint,
} from '@spiderbyte/commercial-domain';
import {
  CapabilityUnavailableError,
  type AuditReader,
  type AuditWriter,
  type Clock,
  type CommercialStore,
  type IdGenerator,
  type TokenGenerator,
} from '@spiderbyte/commercial-ports';
import { CommercialEntitlementService } from '@spiderbyte/commercial-billing';

import { CommercialAdminCodes, CommercialAdminError } from './errors';
import type { WebhookDeliveryAdapter } from './webhooks';

type AdminAction =
  | 'organization.manage'
  | 'member.manage'
  | 'policy.manage'
  | 'audit.read'
  | 'support.grant'
  | 'enterprise.manage';

export interface AdminAuthorizationGate {
  authorize(
    principal: Principal,
    organizationId: string,
    action: AdminAction,
    requestId: string,
    workspaceId?: string,
  ): Promise<void>;
}

export interface CommercialAdminDependencies {
  readonly store: CommercialStore;
  readonly entitlement: CommercialEntitlementService;
  readonly authorize: AdminAuthorizationGate;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly tokens: TokenGenerator;
  readonly audit: AuditWriter;
  readonly auditReader: AuditReader;
  readonly webhookDelivery: WebhookDeliveryAdapter;
}

export class CommercialAdminService {
  constructor(private readonly deps: CommercialAdminDependencies) {}

  async createCustomRole(input: {
    readonly principal: Principal;
    readonly account_id: string;
    readonly organization_id: string;
    readonly name: string;
    readonly permission_keys: readonly string[];
    readonly actor: ActorRef;
    readonly request_id: string;
  }): Promise<Role> {
    await this.deps.authorize.authorize(input.principal, input.organization_id, 'organization.manage', input.request_id);
    const fingerprint = hashSecret(JSON.stringify({ account_id: input.account_id, organization_id: input.organization_id, name: input.name, permission_keys: input.permission_keys }));
    const replay = await this.replayResult<Role>('role.create', input.request_id, fingerprint);
    if (replay !== undefined) return replay;
    await this.deps.entitlement.assertIncluded(input.organization_id, 'advanced_rbac');
    const unknown = input.permission_keys.filter((key) => !COMMERCIAL_ACTIONS.includes(key as (typeof COMMERCIAL_ACTIONS)[number]));
    if (unknown.length > 0) throw new CommercialAdminError(CommercialAdminCodes.ROLE_NOT_FOUND, 'custom role contains unsupported permissions', { unknown });
    if (input.permission_keys.includes('support.grant')) await this.deps.entitlement.assertIncluded(input.organization_id, 'support_access');
    const now = this.deps.clock.now();
    const role = roleSchema.parse({
      id: this.deps.ids.next('role_'), account_id: input.account_id, organization_id: input.organization_id,
      name: input.name, kind: 'custom', permission_keys: input.permission_keys, state: 'active', version: 1,
      created_at: now, updated_at: now, created_by: input.actor, updated_by: input.actor,
    });
    await this.deps.store.transaction(async (store) => {
      await store.put('roles', role.id, role);
      await this.rememberResult(store, 'role.create', input.request_id, fingerprint, role);
    });
    await this.audit(input.account_id, input.organization_id, undefined, input.actor, 'role.create', 'role', role.id, input.request_id, now);
    return role;
  }

  async createTeam(input: {
    readonly principal: Principal;
    readonly account_id: string;
    readonly organization_id: string;
    readonly name: string;
    readonly workspace_ids?: readonly string[];
    readonly actor: ActorRef;
    readonly request_id: string;
  }): Promise<Team> {
    await this.deps.authorize.authorize(input.principal, input.organization_id, 'organization.manage', input.request_id);
    const fingerprint = hashSecret(JSON.stringify({ account_id: input.account_id, organization_id: input.organization_id, name: input.name, workspace_ids: input.workspace_ids }));
    const replay = await this.replayResult<Team>('team.create', input.request_id, fingerprint);
    if (replay !== undefined) return replay;
    const now = this.deps.clock.now();
    const team = teamSchema.parse({
      id: this.deps.ids.next('team_'), account_id: input.account_id, organization_id: input.organization_id,
      name: input.name, state: 'active', workspace_ids: input.workspace_ids ?? [], version: 1,
      created_at: now, updated_at: now, created_by: input.actor, updated_by: input.actor,
    });
    await this.deps.store.transaction(async (store) => {
      await store.put('teams', team.id, team);
      await this.rememberResult(store, 'team.create', input.request_id, fingerprint, team);
    });
    await this.audit(input.account_id, input.organization_id, undefined, input.actor, 'team.create', 'team', team.id, input.request_id, now);
    return team;
  }

  async createGroup(input: {
    readonly principal: Principal;
    readonly account_id: string;
    readonly organization_id: string;
    readonly name: string;
    readonly actor: ActorRef;
    readonly request_id: string;
  }): Promise<Group> {
    await this.deps.authorize.authorize(input.principal, input.organization_id, 'organization.manage', input.request_id);
    await this.deps.entitlement.assertIncluded(input.organization_id, 'advanced_rbac');
    const now = this.deps.clock.now();
    const group = groupSchema.parse({
      id: this.deps.ids.next('group_'), account_id: input.account_id, organization_id: input.organization_id,
      name: input.name, state: 'active', member_user_ids: [], version: 1,
      created_at: now, updated_at: now, created_by: input.actor, updated_by: input.actor,
    });
    await this.deps.store.put('groups', group.id, group);
    return group;
  }

  async addUserToGroup(input: {
    readonly principal: Principal;
    readonly organization_id: string;
    readonly group_id: string;
    readonly user_id: string;
    readonly actor: ActorRef;
    readonly request_id: string;
  }): Promise<Group> {
    await this.deps.authorize.authorize(input.principal, input.organization_id, 'member.manage', input.request_id);
    const group = await this.deps.store.get('groups', input.group_id);
    if (group === undefined || group.organization_id !== input.organization_id) throw new CommercialAdminError(CommercialAdminCodes.GROUP_NOT_FOUND, 'group not found');
    const now = this.deps.clock.now();
    const updated = groupSchema.parse({
      ...group,
      member_user_ids: group.member_user_ids.includes(input.user_id) ? group.member_user_ids : [...group.member_user_ids, input.user_id],
      version: group.version + 1,
      updated_at: now,
      updated_by: input.actor,
    });
    await this.deps.store.put('groups', updated.id, updated);
    return updated;
  }

  async createServiceAccount(input: {
    readonly principal: Principal;
    readonly account_id: string;
    readonly organization_id: string;
    readonly workspace_id?: string;
    readonly name: string;
    readonly scopes: readonly string[];
    readonly actor: ActorRef;
    readonly request_id: string;
  }): Promise<{ readonly service_account: ServiceAccount; readonly client_secret: string }> {
    await this.deps.authorize.authorize(input.principal, input.organization_id, 'member.manage', input.request_id, input.workspace_id);
    await this.deps.entitlement.assertIncluded(input.organization_id, 'service_accounts');
    const invalidScopes = input.scopes.filter((scope) => !COMMERCIAL_ACTIONS.includes(scope as (typeof COMMERCIAL_ACTIONS)[number]));
    if (invalidScopes.length > 0) throw new CommercialAdminError(CommercialAdminCodes.SERVICE_ACCOUNT_NOT_FOUND, 'service account contains unsupported scopes', { invalidScopes });
    if (input.scopes.includes('support.grant')) await this.deps.entitlement.assertIncluded(input.organization_id, 'support_access');
    await this.assertSecretCommandFresh('service_account.create', input.request_id);
    const now = this.deps.clock.now();
    const clientSecret = `sbs_${this.deps.tokens.token(32)}`;
    const serviceAccount = serviceAccountSchema.parse({
      id: this.deps.ids.next('svc_'), account_id: input.account_id, organization_id: input.organization_id,
      workspace_id: input.workspace_id, name: input.name, state: 'active', scopes: input.scopes,
      credential_hash: hashSecret(clientSecret), version: 1, created_at: now, updated_at: now,
      created_by: input.actor, updated_by: input.actor,
    });
    await this.deps.store.transaction(async (store) => {
      await store.put('service_accounts', serviceAccount.id, serviceAccount);
      await this.rememberSanitized(store, 'service_account.create', input.request_id, serviceAccount);
    });
    await this.audit(input.account_id, input.organization_id, input.workspace_id, input.actor, 'service_account.create', 'service_account', serviceAccount.id, input.request_id, now, { scopes: input.scopes });
    return { service_account: serviceAccount, client_secret: clientSecret };
  }

  async createApiKey(input: {
    readonly principal: Principal;
    readonly actor: ActorRef;
    readonly request_id: string;
  } & CreateApiKeyInput & { readonly workspace_id?: string }): Promise<{ readonly api_key: ApiKey; readonly secret: string }> {
    await this.deps.authorize.authorize(input.principal, input.organization_id, 'member.manage', input.request_id, input.workspace_id);
    await this.deps.entitlement.assertIncluded(input.organization_id, 'api_access');
    await this.assertSecretCommandFresh('api_key.create', input.request_id);
    const command = createApiKeyInputSchema.parse({
      account_id: input.account_id, organization_id: input.organization_id, owner_user_id: input.owner_user_id,
      service_account_id: input.service_account_id, name: input.name, scopes: input.scopes, expires_at: input.expires_at,
    });
    const invalidScopes = command.scopes.filter((scope) => !COMMERCIAL_ACTIONS.includes(scope as (typeof COMMERCIAL_ACTIONS)[number]));
    if (invalidScopes.length > 0) throw new CommercialAdminError(CommercialAdminCodes.API_KEY_NOT_FOUND, 'API key contains unsupported scopes', { invalidScopes });
    if (command.scopes.includes('support.grant')) await this.deps.entitlement.assertIncluded(input.organization_id, 'support_access');
    if (command.service_account_id !== undefined) {
      const service = await this.deps.store.get('service_accounts', command.service_account_id);
      if (service === undefined || service.organization_id !== input.organization_id || service.state !== 'active') {
        throw new CommercialAdminError(CommercialAdminCodes.SERVICE_ACCOUNT_NOT_FOUND, 'service account not found');
      }
      if (command.scopes.some((scope) => !service.scopes.includes(scope))) {
        throw new CommercialAdminError(CommercialAdminCodes.API_KEY_NOT_FOUND, 'API key scope exceeds service account scope');
      }
    }
    const now = this.deps.clock.now();
    const secret = `sbk_${this.deps.tokens.token(32)}`;
    const key = apiKeySchema.parse({
      id: this.deps.ids.next('key_'), account_id: input.account_id, organization_id: input.organization_id,
      workspace_id: input.workspace_id, owner_user_id: command.owner_user_id, service_account_id: command.service_account_id,
      name: command.name, key_prefix: secret.slice(0, 16), key_hash: hashSecret(secret), state: 'active', scopes: command.scopes,
      expires_at: command.expires_at, version: 1, created_at: now, updated_at: now,
      created_by: input.actor, updated_by: input.actor,
    });
    await this.deps.store.transaction(async (store) => {
      await store.put('api_keys', key.id, key);
      await this.rememberSanitized(store, 'api_key.create', input.request_id, key);
    });
    await this.audit(input.account_id, input.organization_id, input.workspace_id, input.actor, 'api_key.create', 'api_key', key.id, input.request_id, now, { scopes: key.scopes, key_prefix: key.key_prefix });
    return { api_key: key, secret };
  }

  async rotateApiKey(input: {
    readonly principal: Principal;
    readonly account_id: string;
    readonly organization_id: string;
    readonly api_key_id: string;
    readonly actor: ActorRef;
    readonly request_id: string;
  }): Promise<{ readonly api_key: ApiKey; readonly secret: string }> {
    await this.deps.authorize.authorize(input.principal, input.organization_id, 'member.manage', input.request_id);
    await this.assertSecretCommandFresh('api_key.rotate', input.request_id);
    const current = await this.deps.store.get('api_keys', input.api_key_id);
    if (current === undefined || current.organization_id !== input.organization_id || current.state !== 'active') throw new CommercialAdminError(CommercialAdminCodes.API_KEY_NOT_FOUND, 'API key not found');
    const created = await this.createApiKey({
      principal: input.principal,
      account_id: input.account_id,
      organization_id: input.organization_id,
      workspace_id: current.workspace_id,
      owner_user_id: current.owner_user_id,
      service_account_id: current.service_account_id,
      name: current.name,
      scopes: current.scopes,
      expires_at: current.expires_at,
      actor: input.actor,
      request_id: `${input.request_id}:new`,
    });
    const now = this.deps.clock.now();
    await this.deps.store.put('api_keys', current.id, apiKeySchema.parse({ ...current, state: 'revoked', version: current.version + 1, updated_at: now, updated_by: input.actor }));
    const rotated = apiKeySchema.parse({ ...created.api_key, rotated_from_id: current.id });
    await this.deps.store.transaction(async (store) => {
      await store.put('api_keys', rotated.id, rotated);
      await this.rememberSanitized(store, 'api_key.rotate', input.request_id, rotated);
    });
    return { ...created, api_key: rotated };
  }

  async createPolicy(input: {
    readonly principal: Principal;
    readonly account_id: string;
    readonly organization_id: string;
    readonly rules: Record<string, unknown>;
    readonly inherited?: boolean;
    readonly actor: ActorRef;
    readonly request_id: string;
  }): Promise<OrganizationPolicy> {
    await this.deps.authorize.authorize(input.principal, input.organization_id, 'policy.manage', input.request_id);
    assertSafeMetadata(input.rules);
    const now = this.deps.clock.now();
    const policy = organizationPolicySchema.parse({
      id: this.deps.ids.next('policy_'), account_id: input.account_id, organization_id: input.organization_id,
      inherited: input.inherited ?? true, rules: input.rules, state: 'active', version: 1,
      created_at: now, updated_at: now, created_by: input.actor, updated_by: input.actor,
    });
    await this.deps.store.put('organization_policies', policy.id, policy);
    await this.audit(input.account_id, input.organization_id, undefined, input.actor, 'policy.create', 'organization_policy', policy.id, input.request_id, now);
    return policy;
  }

  async grantSupportAccess(input: {
    readonly principal: Principal;
    readonly account_id: string;
    readonly organization_id: string;
    readonly support_actor: ActorRef;
    readonly reason: string;
    readonly scope: readonly string[];
    readonly expires_at: string;
    readonly approved: boolean;
    readonly actor: ActorRef;
    readonly request_id: string;
  }): Promise<SupportAccessGrant> {
    await this.deps.authorize.authorize(input.principal, input.organization_id, 'support.grant', input.request_id);
    if (Date.parse(input.expires_at) <= Date.parse(this.deps.clock.now())) throw new CommercialAdminError(CommercialAdminCodes.SUPPORT_GRANT_NOT_FOUND, 'support grant must expire in the future');
    const now = this.deps.clock.now();
    const grant = supportAccessGrantSchema.parse({
      id: this.deps.ids.next('support_'), account_id: input.account_id, organization_id: input.organization_id,
      granting_actor: input.actor, support_actor: input.support_actor, reason: input.reason, scope: input.scope,
      state: input.approved ? 'active' : 'pending_approval', expires_at: input.expires_at,
      approved_by: input.approved ? input.actor : undefined, version: 1, created_at: now, updated_at: now,
      created_by: input.actor, updated_by: input.actor,
    });
    await this.deps.store.put('support_grants', grant.id, grant);
    await this.audit(input.account_id, input.organization_id, undefined, input.actor, 'support_access.grant', 'support_grant', grant.id, input.request_id, now, { scope: input.scope, expires_at: input.expires_at });
    return grant;
  }

  async revokeSupportAccess(input: { readonly principal: Principal; readonly organization_id: string; readonly grant_id: string; readonly actor: ActorRef; readonly request_id: string }): Promise<SupportAccessGrant> {
    await this.deps.authorize.authorize(input.principal, input.organization_id, 'support.grant', input.request_id);
    const grant = await this.deps.store.get('support_grants', input.grant_id);
    if (grant === undefined || grant.organization_id !== input.organization_id) throw new CommercialAdminError(CommercialAdminCodes.SUPPORT_GRANT_NOT_FOUND, 'support grant not found');
    const now = this.deps.clock.now();
    const revoked = supportAccessGrantSchema.parse({ ...grant, state: 'revoked', revoked_at: now, version: grant.version + 1, updated_at: now, updated_by: input.actor });
    await this.deps.store.put('support_grants', revoked.id, revoked);
    await this.audit(grant.account_id, grant.organization_id, undefined, input.actor, 'support_access.revoke', 'support_grant', grant.id, input.request_id, now);
    return revoked;
  }

  async createWebhook(input: {
    readonly principal: Principal;
    readonly account_id: string;
    readonly organization_id: string;
    readonly url: string;
    readonly event_types: readonly string[];
    readonly actor: ActorRef;
    readonly request_id: string;
  }): Promise<{ readonly endpoint: WebhookEndpoint; readonly secret: string }> {
    await this.deps.authorize.authorize(input.principal, input.organization_id, 'organization.manage', input.request_id);
    await this.deps.entitlement.assertIncluded(input.organization_id, 'webhooks');
    assertWebhookUrlSafe(input.url);
    await this.assertSecretCommandFresh('webhook.create', input.request_id);
    const now = this.deps.clock.now();
    const secret = `whsec_${this.deps.tokens.token(32)}`;
    const endpoint = webhookEndpointSchema.parse({
      id: this.deps.ids.next('webhook_'), account_id: input.account_id, organization_id: input.organization_id,
      url: input.url, secret_ref: `secret_webhook_${this.deps.ids.next('ref_')}`, event_types: input.event_types,
      state: 'active', failure_count: 0, version: 1, created_at: now, updated_at: now,
      created_by: input.actor, updated_by: input.actor,
    });
    await this.deps.store.transaction(async (store) => {
      await store.put('webhook_endpoints', endpoint.id, endpoint);
      await this.rememberSanitized(store, 'webhook.create', input.request_id, endpoint);
    });
    await this.deps.audit.append({ account_id: input.account_id, organization_id: input.organization_id, actor: input.actor, action: 'webhook.create', target_type: 'webhook_endpoint', target_id: endpoint.id, outcome: 'succeeded', request_id: input.request_id, occurred_at: now, detail: { event_types: input.event_types, secret_ref: endpoint.secret_ref } });
    return { endpoint, secret };
  }

  async deliverWebhook(input: { readonly principal: Principal; readonly organization_id: string; readonly endpoint_id: string; readonly event_id: string; readonly event_type: string; readonly payload: Record<string, unknown>; readonly actor: ActorRef; readonly request_id: string }): Promise<{ readonly delivered: boolean; readonly response_code?: number; readonly retry_after_ms?: number }> {
    await this.deps.authorize.authorize(input.principal, input.organization_id, 'organization.manage', input.request_id);
    const endpoint = await this.deps.store.get('webhook_endpoints', input.endpoint_id);
    if (endpoint === undefined || endpoint.organization_id !== input.organization_id || endpoint.state !== 'active' || !endpoint.event_types.includes(input.event_type)) throw new CommercialAdminError(CommercialAdminCodes.WEBHOOK_NOT_FOUND, 'webhook endpoint is not available');
    const idempotencyKey = `webhook:${endpoint.id}:${input.event_id}`;
    const fingerprint = hashSecret(JSON.stringify({
      organization_id: input.organization_id,
      endpoint_id: input.endpoint_id,
      event_id: input.event_id,
      event_type: input.event_type,
      payload: input.payload,
    }));
    const replay = await this.deps.store.get('idempotency', idempotencyKey);
    if (replay !== undefined) {
      if (replay.fingerprint !== fingerprint) throw new CommercialAdminError(CommercialAdminCodes.IDEMPOTENCY_REUSED, 'webhook event id was reused with different input');
      return JSON.parse(replay.result_json) as { readonly delivered: boolean; readonly response_code?: number; readonly retry_after_ms?: number };
    }
    const status = this.deps.webhookDelivery.capability();
    if (status.availability !== 'available') throw new CapabilityUnavailableError(status);
    const result = await this.deps.webhookDelivery.deliver({ endpoint, event_id: input.event_id, payload: JSON.stringify(input.payload), attempt: endpoint.failure_count + 1, idempotency_key: idempotencyKey });
    const now = this.deps.clock.now();
    await this.deps.store.transaction(async (store) => {
      await store.put('idempotency', idempotencyKey, { scope: 'webhook.delivery', request_id: input.request_id, fingerprint, result_json: JSON.stringify(result), created_at: now });
      await store.put('webhook_endpoints', endpoint.id, webhookEndpointSchema.parse({ ...endpoint, last_delivery_at: now, failure_count: result.delivered ? 0 : endpoint.failure_count + 1, version: endpoint.version + 1, updated_at: now, updated_by: input.actor }));
    });
    await this.deps.audit.append({ account_id: endpoint.account_id, organization_id: endpoint.organization_id, actor: input.actor, action: 'webhook.deliver', target_type: 'webhook_endpoint', target_id: endpoint.id, outcome: result.delivered ? 'succeeded' : 'failed', request_id: input.request_id, occurred_at: now, detail: { event_id: input.event_id, delivered: result.delivered, response_code: result.response_code } });
    return result;
  }

  async exportAudit(input: { readonly principal: Principal; readonly account_id: string; readonly organization_id: string; readonly workspace_id?: string; readonly actor: ActorRef; readonly request_id: string }): Promise<{ readonly content_type: 'application/json'; readonly body: string }> {
    await this.deps.authorize.authorize(input.principal, input.organization_id, 'audit.read', input.request_id, input.workspace_id);
    const events = await this.deps.auditReader.read({ account_id: input.account_id, organization_id: input.organization_id, workspace_id: input.workspace_id });
    const body = JSON.stringify(events);
    await this.audit(input.account_id, input.organization_id, input.workspace_id, input.actor, 'audit.export', 'audit_export', `audit-export-${input.request_id}`, input.request_id, this.deps.clock.now(), { event_count: events.length });
    return { content_type: 'application/json', body };
  }

  async expireSupportAccess(at = this.deps.clock.now()): Promise<readonly SupportAccessGrant[]> {
    const changed: SupportAccessGrant[] = [];
    for (const grant of await this.deps.store.list('support_grants')) {
      if (!['active', 'pending_approval'].includes(grant.state) || Date.parse(grant.expires_at) > Date.parse(at)) continue;
      const expired = supportAccessGrantSchema.parse({ ...grant, state: 'expired', version: grant.version + 1, updated_at: at, updated_by: { kind: 'system', id: 'support-expiry' } });
      await this.deps.store.put('support_grants', expired.id, expired);
      changed.push(expired);
    }
    return changed;
  }

  private async audit(accountId: string, organizationId: string, workspaceId: string | undefined, actor: ActorRef, action: string, targetType: string, targetId: string, requestId: string, occurredAt: string, detail?: Record<string, unknown>): Promise<void> {
    assertSafeMetadata(detail);
    await this.deps.audit.append({ account_id: accountId, organization_id: organizationId, workspace_id: workspaceId, actor, action, target_type: targetType, target_id: targetId, outcome: 'succeeded', request_id: requestId, occurred_at: occurredAt, detail });
  }

  private async assertSecretCommandFresh(scope: string, requestId: string): Promise<void> {
    if (await this.deps.store.get('idempotency', `${scope}:${requestId}`) !== undefined) {
      throw new CommercialAdminError(CommercialAdminCodes.INVALID_SECRET_REPLAY, 'the credential was already created; its one-time secret is not stored and cannot be replayed');
    }
  }

  private async replayResult<T>(scope: string, requestId: string, fingerprint: string): Promise<T | undefined> {
    const record = await this.deps.store.get('idempotency', `${scope}:${requestId}`);
    if (record === undefined) return undefined;
    if (record.fingerprint !== fingerprint) {
      throw new CommercialAdminError(CommercialAdminCodes.IDEMPOTENCY_REUSED, 'request id was reused with different input');
    }
    return JSON.parse(record.result_json) as T;
  }

  private async rememberResult(store: CommercialStore, scope: string, requestId: string, fingerprint: string, result: unknown): Promise<void> {
    await store.put('idempotency', `${scope}:${requestId}`, {
      scope,
      request_id: requestId,
      fingerprint,
      result_json: JSON.stringify(result),
      created_at: this.deps.clock.now(),
    });
  }

  private async rememberSanitized(store: CommercialStore, scope: string, requestId: string, result: unknown): Promise<void> {
    await store.put('idempotency', `${scope}:${requestId}`, {
      scope,
      request_id: requestId,
      fingerprint: hashSecret(JSON.stringify(result)),
      result_json: JSON.stringify(result),
      created_at: this.deps.clock.now(),
    });
  }
}

function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertWebhookUrlSafe(value: string): void {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') throw new CommercialAdminError(CommercialAdminCodes.WEBHOOK_NOT_FOUND, 'webhook URL must be HTTPS without embedded credentials');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname === '::1' || hostname === '0.0.0.0' || hostname.startsWith('127.') || hostname.startsWith('10.') || hostname.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) {
    throw new CommercialAdminError(CommercialAdminCodes.WEBHOOK_NOT_FOUND, 'webhook URL resolves to a private or loopback address');
  }
}
