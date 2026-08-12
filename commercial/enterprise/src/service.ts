import { createHash } from 'node:crypto';

import {
  enterpriseConfigurationSchema,
  identityProviderSchema,
  organizationSchema,
  userSchema,
  verifiedDomainSchema,
  type ActorRef,
  type CapabilityStatus,
  type EnterpriseConfiguration,
  type IdentityProvider,
  type Principal,
  type VerifiedDomain,
} from '@spiderbyte/commercial-domain';
import {
  CapabilityUnavailableError,
  type AuditWriter,
  type Clock,
  type CommercialStore,
  type CustomerManagedKeyAdapter,
  type DomainVerificationAdapter,
  type EnterpriseIdentityAdapter,
  type IdGenerator,
  type PrivateNetworkAdapter,
  type ScimAdapter,
  type TokenGenerator,
} from '@spiderbyte/commercial-ports';
import { CommercialEntitlementService } from '@spiderbyte/commercial-billing';

import { CommercialEnterpriseCodes, CommercialEnterpriseError } from './errors';

export interface EnterpriseAuthorizationGate {
  authorize(principal: Principal, organizationId: string, requestId: string): Promise<void>;
}

export interface EnterpriseServiceDependencies {
  readonly store: CommercialStore;
  readonly identity: EnterpriseIdentityAdapter;
  readonly scim: ScimAdapter;
  readonly domainVerification: DomainVerificationAdapter;
  readonly customerManagedKeys: CustomerManagedKeyAdapter;
  readonly privateNetwork: PrivateNetworkAdapter;
  readonly entitlement: CommercialEntitlementService;
  readonly authorize: EnterpriseAuthorizationGate;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly tokens: TokenGenerator;
  readonly audit: AuditWriter;
}

export class EnterpriseSecurityService {
  constructor(private readonly deps: EnterpriseServiceDependencies) {}

  capabilityStatus(): Readonly<Record<'sso' | 'scim' | 'customer_managed_keys' | 'private_networking', CapabilityStatus>> {
    return {
      sso: this.deps.identity.capability(),
      scim: this.deps.scim.capability(),
      customer_managed_keys: this.deps.customerManagedKeys.capability(),
      private_networking: this.deps.privateNetwork.capability(),
    };
  }

  async configureIdentityProvider(input: {
    readonly principal: Principal;
    readonly account_id: string;
    readonly organization_id: string;
    readonly type: IdentityProvider['type'];
    readonly issuer?: string;
    readonly entity_id?: string;
    readonly client_id?: string;
    readonly actor: ActorRef;
    readonly request_id: string;
  }): Promise<{ readonly provider: IdentityProvider; readonly capability: CapabilityStatus; readonly production_ready: boolean }> {
    await this.authorize(input);
    const fingerprint = hashJson({ account_id: input.account_id, organization_id: input.organization_id, type: input.type, issuer: input.issuer, entity_id: input.entity_id, client_id: input.client_id });
    const replay = await this.replay<{ readonly provider: IdentityProvider; readonly capability: CapabilityStatus; readonly production_ready: boolean }>('enterprise.idp.configure', input.request_id, fingerprint);
    if (replay !== undefined) return replay;
    await this.deps.entitlement.assertIncluded(input.organization_id, 'sso');
    if (input.type === 'oidc' && input.issuer === undefined) throw new CommercialEnterpriseError(CommercialEnterpriseCodes.CONFIGURATION_INVALID, 'OIDC requires an issuer URL');
    if (input.type === 'saml' && input.entity_id === undefined) throw new CommercialEnterpriseError(CommercialEnterpriseCodes.CONFIGURATION_INVALID, 'SAML requires an entity ID');
    const now = this.deps.clock.now();
    const provider = identityProviderSchema.parse({
      id: this.deps.ids.next('idp_'), account_id: input.account_id, organization_id: input.organization_id,
      type: input.type, state: 'draft', issuer: input.issuer, entity_id: input.entity_id, client_id: input.client_id,
      secret_ref: `secret_idp_${this.deps.ids.next('ref_')}`, enforced: false, version: 1,
      created_at: now, updated_at: now, created_by: input.actor, updated_by: input.actor,
    });
    const capability = this.deps.identity.capability();
    if (capability.availability !== 'available') {
      await this.deps.store.put('identity_providers', provider.id, provider);
      const result = { provider, capability, production_ready: false } as const;
      await this.remember('enterprise.idp.configure', input.request_id, fingerprint, result);
      return result;
    }
    const validation = await this.deps.identity.validateProvider({ provider });
    const validated = identityProviderSchema.parse({ ...provider, state: validation.valid ? 'configured' : 'draft', last_validated_at: now, version: provider.version + 1, updated_at: now, updated_by: input.actor });
    await this.deps.store.put('identity_providers', validated.id, validated);
    await this.audit(input.account_id, input.organization_id, input.actor, 'identity_provider.configure', 'identity_provider', validated.id, input.request_id, now, { valid: validation.valid, reason: validation.reason });
    const result = { provider: validated, capability, production_ready: validation.valid } as const;
    await this.remember('enterprise.idp.configure', input.request_id, fingerprint, result);
    return result;
  }

  async issueDomainVerification(input: {
    readonly principal: Principal;
    readonly account_id: string;
    readonly organization_id: string;
    readonly domain: string;
    readonly actor: ActorRef;
    readonly request_id: string;
  }): Promise<{ readonly domain: VerifiedDomain; readonly capability: CapabilityStatus; readonly challenge?: { readonly method: 'dns_txt' | 'dns_cname' | 'http'; readonly record: string }; readonly token?: string }> {
    await this.authorize(input);
    await this.deps.entitlement.assertIncluded(input.organization_id, 'sso');
    const now = this.deps.clock.now();
    const token = this.deps.tokens.token(32);
    const domain = verifiedDomainSchema.parse({
      id: this.deps.ids.next('domain_'), account_id: input.account_id, organization_id: input.organization_id,
      domain: input.domain, state: 'pending', verification_method: 'dns_txt', verification_token_hash: hashSecret(token),
      version: 1, created_at: now, updated_at: now, created_by: input.actor, updated_by: input.actor,
    });
    const capability = this.deps.domainVerification.capability();
    if (capability.availability !== 'available') {
      await this.deps.store.put('verified_domains', domain.id, domain);
      return { domain, capability };
    }
    const challenge = await this.deps.domainVerification.issueChallenge({ domain: domain.domain, token });
    const challenged = verifiedDomainSchema.parse({ ...domain, verification_method: challenge.method, version: domain.version + 1, updated_at: now, updated_by: input.actor });
    await this.deps.store.put('verified_domains', challenged.id, challenged);
    return { domain: challenged, capability, challenge, token };
  }

  async completeDomainVerification(input: { readonly principal: Principal; readonly organization_id: string; readonly domain_id: string; readonly token: string; readonly actor: ActorRef; readonly request_id: string }): Promise<VerifiedDomain> {
    await this.authorize(input);
    const domain = await this.deps.store.get('verified_domains', input.domain_id);
    if (domain === undefined || domain.organization_id !== input.organization_id) throw new CommercialEnterpriseError(CommercialEnterpriseCodes.DOMAIN_NOT_FOUND, 'verified domain not found');
    const capability = this.deps.domainVerification.capability();
    if (capability.availability !== 'available') throw new CapabilityUnavailableError(capability);
    const valid = await this.deps.domainVerification.verify({ domain: domain.domain, token_hash: hashSecret(input.token) });
    if (!valid) throw new CommercialEnterpriseError(CommercialEnterpriseCodes.DOMAIN_NOT_VERIFIED, 'domain verification failed');
    const now = this.deps.clock.now();
    const verified = verifiedDomainSchema.parse({ ...domain, state: 'verified', verified_at: now, version: domain.version + 1, updated_at: now, updated_by: input.actor });
    await this.deps.store.put('verified_domains', verified.id, verified);
    await this.audit(verified.account_id, verified.organization_id, input.actor, 'domain.verify', 'verified_domain', verified.id, input.request_id, now);
    return verified;
  }

  async configureEnterprise(input: {
    readonly principal: Principal;
    readonly account_id: string;
    readonly organization_id: string;
    readonly identity_provider_id?: string;
    readonly verified_domain_ids?: readonly string[];
    readonly enforced_sso: boolean;
    readonly group_role_mappings?: Record<string, readonly string[]>;
    readonly mfa_required?: boolean;
    readonly ip_allowlist?: readonly string[];
    readonly api_restrictions?: readonly string[];
    readonly data_residency?: string;
    readonly encryption_mode?: 'platform_managed' | 'customer_managed';
    readonly kms_key_ref?: string;
    readonly private_network_ref?: string;
    readonly deployment_mode: 'shared' | 'regional' | 'dedicated';
    readonly release_channel: 'stable' | 'preview' | 'pinned';
    readonly actor: ActorRef;
    readonly request_id: string;
  }): Promise<EnterpriseConfiguration> {
    await this.authorize(input);
    const fingerprint = hashJson({
      account_id: input.account_id,
      organization_id: input.organization_id,
      identity_provider_id: input.identity_provider_id,
      verified_domain_ids: input.verified_domain_ids,
      enforced_sso: input.enforced_sso,
      group_role_mappings: input.group_role_mappings,
      mfa_required: input.mfa_required,
      ip_allowlist: input.ip_allowlist,
      api_restrictions: input.api_restrictions,
      data_residency: input.data_residency,
      encryption_mode: input.encryption_mode,
      kms_key_ref: input.kms_key_ref,
      private_network_ref: input.private_network_ref,
      deployment_mode: input.deployment_mode,
      release_channel: input.release_channel,
    });
    const replay = await this.replay<EnterpriseConfiguration>('enterprise.configure', input.request_id, fingerprint);
    if (replay !== undefined) return replay;
    await this.deps.entitlement.assertIncluded(input.organization_id, 'enterprise_configuration');
    if (input.enforced_sso) {
      if (input.identity_provider_id === undefined) throw new CommercialEnterpriseError(CommercialEnterpriseCodes.CONFIGURATION_INVALID, 'enforced SSO requires an identity provider');
      const provider = await this.deps.store.get('identity_providers', input.identity_provider_id);
      if (provider === undefined || provider.organization_id !== input.organization_id || provider.state !== 'configured' && provider.state !== 'active') throw new CommercialEnterpriseError(CommercialEnterpriseCodes.IDENTITY_PROVIDER_NOT_FOUND, 'configured identity provider is required');
      const domains = await this.deps.store.list('verified_domains');
      if ((input.verified_domain_ids ?? []).some((id) => !domains.some((domain) => domain.id === id && domain.organization_id === input.organization_id && domain.state === 'verified'))) throw new CommercialEnterpriseError(CommercialEnterpriseCodes.DOMAIN_NOT_VERIFIED, 'enforced SSO requires verified domains');
    }
    if (input.encryption_mode === 'customer_managed') {
      const status = this.deps.customerManagedKeys.capability();
      if (status.availability !== 'available') throw new CapabilityUnavailableError(status);
      const checked = await this.deps.customerManagedKeys.validateKey({ organization_id: input.organization_id, key_ref: input.kms_key_ref! });
      if (!checked.valid) throw new CommercialEnterpriseError(CommercialEnterpriseCodes.CONFIGURATION_INVALID, checked.reason ?? 'customer-managed key is invalid');
    }
    if (input.private_network_ref !== undefined) {
      const status = this.deps.privateNetwork.capability();
      if (status.availability !== 'available') throw new CapabilityUnavailableError(status);
      const checked = await this.deps.privateNetwork.validateNetwork({ organization_id: input.organization_id, network_ref: input.private_network_ref });
      if (!checked.valid) throw new CommercialEnterpriseError(CommercialEnterpriseCodes.CONFIGURATION_INVALID, checked.reason ?? 'private network is invalid');
    }
    const now = this.deps.clock.now();
    const configuration = enterpriseConfigurationSchema.parse({
      id: this.deps.ids.next('enterprise_'), account_id: input.account_id, organization_id: input.organization_id,
      identity_provider_id: input.identity_provider_id, verified_domain_ids: input.verified_domain_ids ?? [],
      group_role_mappings: input.group_role_mappings ?? {}, enforced_sso: input.enforced_sso,
      mfa_required: input.mfa_required ?? false, ip_allowlist: input.ip_allowlist ?? [], api_restrictions: input.api_restrictions ?? [],
      data_residency: input.data_residency, encryption_mode: input.encryption_mode ?? 'platform_managed',
      kms_key_ref: input.kms_key_ref, private_network_ref: input.private_network_ref,
      deployment_mode: input.deployment_mode, release_channel: input.release_channel,
      state: 'active', version: 1, created_at: now, updated_at: now, created_by: input.actor, updated_by: input.actor,
    });
    const organization = await this.deps.store.get('organizations', input.organization_id);
    await this.deps.store.transaction(async (store) => {
      await store.put('enterprise_configurations', configuration.id, configuration);
      if (organization !== undefined) await store.put('organizations', organization.id, organizationSchema.parse({ ...organization, enforced_sso: input.enforced_sso, version: organization.version + 1, updated_at: now, updated_by: input.actor }));
      await this.rememberInStore(store, 'enterprise.configure', input.request_id, fingerprint, configuration);
    });
    await this.audit(input.account_id, input.organization_id, input.actor, 'enterprise.configure', 'enterprise_configuration', configuration.id, input.request_id, now, { deployment_mode: configuration.deployment_mode, enforced_sso: configuration.enforced_sso });
    return configuration;
  }

  async provisionScimUser(input: { readonly principal: Principal; readonly organization_id: string; readonly user_id: string; readonly actor: ActorRef; readonly request_id: string }): Promise<{ readonly external_ref: string }> {
    await this.authorize(input);
    await this.deps.entitlement.assertIncluded(input.organization_id, 'scim');
    const user = await this.deps.store.get('users', input.user_id);
    if (user === undefined || user.account_id !== input.principal.account_id || user.state !== 'active') throw new CommercialEnterpriseError(CommercialEnterpriseCodes.SCIM_USER_NOT_FOUND, 'active user not found');
    if (!(await this.deps.store.list('memberships')).some((membership) => membership.organization_id === input.organization_id && membership.user_id === user.id && membership.state === 'active')) {
      throw new CommercialEnterpriseError(CommercialEnterpriseCodes.SCIM_USER_NOT_FOUND, 'user is not an active member of this organization');
    }
    const status = this.deps.scim.capability();
    if (status.availability !== 'available') throw new CapabilityUnavailableError(status);
    const result = await this.deps.scim.provisionUser({ organization_id: input.organization_id, user });
    return result;
  }

  async deprovisionScimUser(input: { readonly principal: Principal; readonly organization_id: string; readonly user_id: string; readonly external_ref: string; readonly actor: ActorRef; readonly request_id: string }): Promise<void> {
    await this.authorize(input);
    await this.deps.entitlement.assertIncluded(input.organization_id, 'scim');
    const user = await this.deps.store.get('users', input.user_id);
    if (user === undefined || user.account_id !== input.principal.account_id) throw new CommercialEnterpriseError(CommercialEnterpriseCodes.SCIM_USER_NOT_FOUND, 'user not found');
    if (!(await this.deps.store.list('memberships')).some((membership) => membership.organization_id === input.organization_id && membership.user_id === user.id && membership.state === 'active')) {
      throw new CommercialEnterpriseError(CommercialEnterpriseCodes.SCIM_USER_NOT_FOUND, 'user is not an active member of this organization');
    }
    const status = this.deps.scim.capability();
    if (status.availability !== 'available') throw new CapabilityUnavailableError(status);
    await this.deps.scim.deprovisionUser({ organization_id: input.organization_id, external_ref: input.external_ref });
    await this.deps.store.put('users', user.id, userSchema.parse({ ...user, state: 'deactivated', version: user.version + 1, updated_at: this.deps.clock.now(), updated_by: input.actor }));
  }

  async syncScimGroups(input: { readonly principal: Principal; readonly organization_id: string; readonly actor: ActorRef; readonly request_id: string }): Promise<{ readonly group_count: number }> {
    await this.authorize(input);
    await this.deps.entitlement.assertIncluded(input.organization_id, 'scim');
    const status = this.deps.scim.capability();
    if (status.availability !== 'available') throw new CapabilityUnavailableError(status);
    return this.deps.scim.syncGroups({ organization_id: input.organization_id });
  }

  private async authorize(input: { readonly principal: Principal; readonly organization_id: string; readonly request_id: string }): Promise<void> {
    await this.deps.authorize.authorize(input.principal, input.organization_id, input.request_id);
  }

  private async replay<T>(scope: string, requestId: string, fingerprint: string): Promise<T | undefined> {
    const record = await this.deps.store.get('idempotency', `${scope}:${requestId}`);
    if (record === undefined) return undefined;
    if (record.fingerprint !== fingerprint) throw new CommercialEnterpriseError(CommercialEnterpriseCodes.IDEMPOTENCY_REUSED, 'request id was reused with different enterprise input');
    return JSON.parse(record.result_json) as T;
  }

  private async remember(scope: string, requestId: string, fingerprint: string, result: unknown): Promise<void> {
    await this.deps.store.put('idempotency', `${scope}:${requestId}`, {
      scope,
      request_id: requestId,
      fingerprint,
      result_json: JSON.stringify(result),
      created_at: this.deps.clock.now(),
    });
  }

  private async rememberInStore(store: CommercialStore, scope: string, requestId: string, fingerprint: string, result: unknown): Promise<void> {
    await store.put('idempotency', `${scope}:${requestId}`, {
      scope,
      request_id: requestId,
      fingerprint,
      result_json: JSON.stringify(result),
      created_at: this.deps.clock.now(),
    });
  }

  private async audit(accountId: string, organizationId: string, actor: ActorRef, action: string, targetType: string, targetId: string, requestId: string, occurredAt: string, detail?: Record<string, unknown>): Promise<void> {
    await this.deps.audit.append({ account_id: accountId, organization_id: organizationId, actor, action, target_type: targetType, target_id: targetId, outcome: 'succeeded', request_id: requestId, occurred_at: occurredAt, detail });
  }
}

function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
