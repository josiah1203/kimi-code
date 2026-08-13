import {
  type CreateAccountInput,
  type CreateOrganizationInput,
  type CreateWorkspaceInput,
  type ActorRef,
  type ComputeExecution,
  type ComputeReservation,
  type EnterpriseConfiguration,
  type IdentityProvider,
  type HostedArtifact,
  type InviteMemberInput,
  type Membership,
  type MembershipRolesInput,
  type OfflineLicense,
  type Principal,
} from '@spiderbyte/commercial-domain';
import type { CommercialDirectoryService } from '@spiderbyte/commercial-application';
import type { CommercialEntitlementService } from '@spiderbyte/commercial-billing';
import type { CommercialAdminService } from '@spiderbyte/commercial-admin';
import type { HostedArtifactService } from '@spiderbyte/commercial-artifacts';
import type { HostedComputeControlPlane } from '@spiderbyte/commercial-compute';
import type { EnterpriseSecurityService } from '@spiderbyte/commercial-enterprise';
import type {
  EntitlementInspection,
  LicenseActivationResult,
  LicenseDeploymentContext,
  LicenseInspection,
  OfflineLicenseService,
} from '@spiderbyte/commercial-licensing';
import type { LicenseSeat } from '@spiderbyte/commercial-domain';
import type { HostedComputePricing } from '@spiderbyte/commercial-ports';

import { CommercialApiError, mapCommercialApiError } from './errors';
import type { CommercialApiEnvelope, CommercialMutationHeaders } from './contracts';

export interface CommercialApiApplicationDependencies {
  readonly directory: CommercialDirectoryService;
  readonly entitlements?: CommercialEntitlementService;
  readonly admin?: CommercialAdminService;
  readonly artifacts?: HostedArtifactService;
  readonly compute?: HostedComputeControlPlane;
  readonly computePricing?: HostedComputePricing;
  readonly enterprise?: EnterpriseSecurityService;
  readonly licensing?: OfflineLicenseService;
}

export interface CommercialComputeSubmission {
  readonly organization_id: string;
  readonly workspace_id: string;
  readonly provider_id: string;
  readonly region_id: string;
  readonly job_class_id: string;
  readonly run_id?: string;
  readonly attempt_id?: string;
  readonly requested_seconds: number;
  readonly timeout_at?: string;
}

/**
 * Transport-neutral hosted application facade. HTTP/WebSocket adapters should
 * call these operations after `CommercialAuthMiddleware` has validated the
 * bearer session; this class never trusts frontend identity fields.
 */
export class CommercialApiApplication {
  constructor(private readonly deps: CommercialApiApplicationDependencies) {}

  async createAccount(headers: CommercialMutationHeaders, input: CreateAccountInput): Promise<CommercialApiEnvelope<Awaited<ReturnType<CommercialDirectoryService['createAccount']>>>> {
    return this.execute(headers.request_id, () => this.deps.directory.createAccount({ ...input, request_id: commandRequestId(headers) }));
  }

  async login(headers: CommercialMutationHeaders, input: { readonly email: string; readonly secret: string }): Promise<CommercialApiEnvelope<Awaited<ReturnType<CommercialDirectoryService['login']>>>> {
    return this.execute(headers.request_id, async () => {
      const result = await this.deps.directory.login(input);
      if (result === undefined) throw new CommercialApiError(401, 'commercial.invalid_session', 'credentials were not accepted');
      return result;
    });
  }

  async createOrganization(headers: CommercialMutationHeaders, principal: Principal, input: CreateOrganizationInput): Promise<CommercialApiEnvelope<Awaited<ReturnType<CommercialDirectoryService['createOrganization']>>>> {
    return this.execute(headers.request_id, () => this.deps.directory.createOrganization(principal, { ...input, request_id: commandRequestId(headers) }));
  }

  async createWorkspace(headers: CommercialMutationHeaders, principal: Principal, input: CreateWorkspaceInput): Promise<CommercialApiEnvelope<Awaited<ReturnType<CommercialDirectoryService['createWorkspace']>>>> {
    return this.execute(headers.request_id, () => this.deps.directory.createWorkspace(principal, { ...input, request_id: commandRequestId(headers) }));
  }

  async entitlement(headers: CommercialMutationHeaders, principal: Principal, organizationId: string, key: string): Promise<CommercialApiEnvelope<Awaited<ReturnType<CommercialEntitlementService['evaluate']>>>> {
    return this.execute(headers.request_id, async () => {
      await this.deps.directory.assertAuthorized(principal, organizationId, 'billing.read', headers.request_id);
      if (this.deps.entitlements === undefined) throw new CommercialApiError(503, 'commercial.billing.not_configured', 'commercial billing is not configured');
      return this.deps.entitlements.evaluate(organizationId, key);
    });
  }

  async activateLicense(
    headers: CommercialMutationHeaders,
    principal: Principal,
    input: { readonly license: OfflineLicense; readonly deployment?: LicenseDeploymentContext },
  ): Promise<CommercialApiEnvelope<LicenseActivationResult>> {
    return this.execute(headers.request_id, async () => {
      const licensing = this.deps.licensing;
      if (licensing === undefined) throw new CommercialApiError(503, 'commercial.licensing.not_configured', 'commercial licensing is not configured');
      return licensing.activate(principal, { ...input, request_id: commandRequestId(headers) });
    });
  }

  async inspectLicense(headers: CommercialMutationHeaders, principal: Principal, organizationId: string): Promise<CommercialApiEnvelope<LicenseInspection>> {
    return this.execute(headers.request_id, async () => {
      const licensing = this.deps.licensing;
      if (licensing === undefined) throw new CommercialApiError(503, 'commercial.licensing.not_configured', 'commercial licensing is not configured');
      return licensing.inspect(principal, organizationId, headers.request_id);
    });
  }

  async inspectLicenseEntitlement(headers: CommercialMutationHeaders, principal: Principal, organizationId: string, capability: string): Promise<CommercialApiEnvelope<EntitlementInspection>> {
    return this.execute(headers.request_id, async () => {
      const licensing = this.deps.licensing;
      if (licensing === undefined) throw new CommercialApiError(503, 'commercial.licensing.not_configured', 'commercial licensing is not configured');
      return licensing.inspectEntitlement(principal, organizationId, capability, headers.request_id);
    });
  }

  async renewLicense(
    headers: CommercialMutationHeaders,
    principal: Principal,
    input: { readonly organization_id: string; readonly license?: OfflineLicense; readonly deployment?: LicenseDeploymentContext },
  ): Promise<CommercialApiEnvelope<LicenseActivationResult>> {
    return this.execute(headers.request_id, async () => {
      const licensing = this.deps.licensing;
      if (licensing === undefined) throw new CommercialApiError(503, 'commercial.licensing.not_configured', 'commercial licensing is not configured');
      return licensing.renew(principal, { ...input, request_id: commandRequestId(headers) });
    });
  }

  async revokeLicense(
    headers: CommercialMutationHeaders,
    principal: Principal,
    organizationId: string,
    licenseId: string,
  ): Promise<CommercialApiEnvelope<Awaited<ReturnType<OfflineLicenseService['revokeLicense']>>>> {
    return this.execute(headers.request_id, async () => {
      const licensing = this.deps.licensing;
      if (licensing === undefined) throw new CommercialApiError(503, 'commercial.licensing.not_configured', 'commercial licensing is not configured');
      return licensing.revokeLicense(principal, { organization_id: organizationId, license_id: licenseId, request_id: commandRequestId(headers) });
    });
  }

  async assignLicenseSeat(
    headers: CommercialMutationHeaders,
    principal: Principal,
    input: { readonly organization_id: string; readonly user_id: string },
  ): Promise<CommercialApiEnvelope<LicenseSeat>> {
    return this.execute(headers.request_id, async () => {
      const licensing = this.deps.licensing;
      if (licensing === undefined) throw new CommercialApiError(503, 'commercial.licensing.not_configured', 'commercial licensing is not configured');
      return licensing.assignSeat(principal, { ...input, request_id: commandRequestId(headers) });
    });
  }

  async revokeLicenseSeat(
    headers: CommercialMutationHeaders,
    principal: Principal,
    organizationId: string,
    seatId: string,
  ): Promise<CommercialApiEnvelope<LicenseSeat>> {
    return this.execute(headers.request_id, async () => {
      const licensing = this.deps.licensing;
      if (licensing === undefined) throw new CommercialApiError(503, 'commercial.licensing.not_configured', 'commercial licensing is not configured');
      return licensing.revokeSeat(principal, { organization_id: organizationId, seat_id: seatId, request_id: commandRequestId(headers) });
    });
  }

  async inviteMember(
    headers: CommercialMutationHeaders,
    principal: Principal,
    input: Omit<InviteMemberInput, 'actor' | 'request_id'>,
  ): Promise<CommercialApiEnvelope<Awaited<ReturnType<CommercialDirectoryService['inviteMember']>>>> {
    return this.execute(headers.request_id, () => this.deps.directory.inviteMember(principal, {
      ...input,
      actor: actorForPrincipal(principal),
      request_id: commandRequestId(headers),
    }));
  }

  async removeMember(
    headers: CommercialMutationHeaders,
    principal: Principal,
    organizationId: string,
    membershipId: string,
  ): Promise<CommercialApiEnvelope<Membership>> {
    return this.execute(headers.request_id, () => this.deps.directory.changeMembershipState(principal, {
      membership_id: membershipId,
      organization_id: organizationId,
      state: 'removed',
      actor: actorForPrincipal(principal),
      request_id: commandRequestId(headers),
    }));
  }

  async changeMemberRoles(
    headers: CommercialMutationHeaders,
    principal: Principal,
    input: Omit<MembershipRolesInput, 'actor' | 'request_id'>,
  ): Promise<CommercialApiEnvelope<Membership>> {
    return this.execute(headers.request_id, () => this.deps.directory.changeMembershipRoles(principal, {
      ...input,
      actor: actorForPrincipal(principal),
      request_id: commandRequestId(headers),
    }));
  }

  async submitCompute(headers: CommercialMutationHeaders, principal: Principal, input: CommercialComputeSubmission): Promise<CommercialApiEnvelope<ComputeReservation>> {
    return this.execute(headers.request_id, async () => {
      const compute = this.deps.compute;
      if (compute === undefined) throw new CommercialApiError(503, 'commercial.hosted_compute.not_configured', 'hosted compute is not configured');
      const pricing = this.deps.computePricing;
      if (pricing === undefined) throw new CommercialApiError(503, 'commercial.compute_pricing.not_configured', 'hosted compute pricing is not configured');
      const price_basis = await pricing.quote(input);
      return compute.submit({
        ...input,
        price_basis,
        principal,
        account_id: principal.account_id,
        actor: actorForPrincipal(principal),
        request_id: commandRequestId(headers),
      });
    });
  }

  async refreshCompute(headers: CommercialMutationHeaders, principal: Principal, organizationId: string, workspaceId: string, executionId: string): Promise<CommercialApiEnvelope<ComputeExecution>> {
    return this.execute(headers.request_id, async () => {
      const compute = this.deps.compute;
      if (compute === undefined) throw new CommercialApiError(503, 'commercial.hosted_compute.not_configured', 'hosted compute is not configured');
      return compute.refresh(principal, organizationId, workspaceId, executionId, headers.request_id);
    });
  }

  async cancelCompute(headers: CommercialMutationHeaders, principal: Principal, organizationId: string, workspaceId: string, executionId: string): Promise<CommercialApiEnvelope<ComputeExecution>> {
    return this.execute(headers.request_id, async () => {
      const compute = this.deps.compute;
      if (compute === undefined) throw new CommercialApiError(503, 'commercial.hosted_compute.not_configured', 'hosted compute is not configured');
      return compute.cancel({
        principal,
        organization_id: organizationId,
        workspace_id: workspaceId,
        execution_id: executionId,
        actor: actorForPrincipal(principal),
        request_id: commandRequestId(headers),
      });
    });
  }

  async putArtifact(headers: CommercialMutationHeaders, principal: Principal, input: {
    readonly organization_id: string;
    readonly workspace_id: string;
    readonly run_id?: string;
    readonly name: string;
    readonly media_type: string;
    readonly bytes: Uint8Array;
    readonly retention_policy_id?: string;
  }): Promise<CommercialApiEnvelope<HostedArtifact>> {
    return this.execute(headers.request_id, async () => {
      const artifacts = this.deps.artifacts;
      if (artifacts === undefined) throw new CommercialApiError(503, 'commercial.hosted_artifacts.not_configured', 'hosted artifacts are not configured');
      return artifacts.put({
        ...input,
        principal,
        account_id: principal.account_id,
        actor: actorForPrincipal(principal),
        request_id: commandRequestId(headers),
      });
    });
  }

  async issueArtifactDownload(headers: CommercialMutationHeaders, principal: Principal, organizationId: string, workspaceId: string, artifactId: string, expiresAt: string): Promise<CommercialApiEnvelope<{ readonly url: string; readonly expires_at: string }>> {
    return this.execute(headers.request_id, async () => {
      const artifacts = this.deps.artifacts;
      if (artifacts === undefined) throw new CommercialApiError(503, 'commercial.hosted_artifacts.not_configured', 'hosted artifacts are not configured');
      return artifacts.issueDownload({
        principal,
        organization_id: organizationId,
        workspace_id: workspaceId,
        artifact_id: artifactId,
        expires_at: expiresAt,
        actor: actorForPrincipal(principal),
        request_id: headers.request_id,
      });
    });
  }

  async deleteArtifact(headers: CommercialMutationHeaders, principal: Principal, organizationId: string, workspaceId: string, artifactId: string): Promise<CommercialApiEnvelope<HostedArtifact>> {
    return this.execute(headers.request_id, async () => {
      const artifacts = this.deps.artifacts;
      if (artifacts === undefined) throw new CommercialApiError(503, 'commercial.hosted_artifacts.not_configured', 'hosted artifacts are not configured');
      return artifacts.delete({
        principal,
        organization_id: organizationId,
        workspace_id: workspaceId,
        artifact_id: artifactId,
        actor: actorForPrincipal(principal),
        request_id: commandRequestId(headers),
      });
    });
  }

  async createTeam(headers: CommercialMutationHeaders, principal: Principal, input: { readonly organization_id: string; readonly name: string; readonly workspace_ids?: readonly string[] }): Promise<CommercialApiEnvelope<Awaited<ReturnType<CommercialAdminService['createTeam']>>>> {
    return this.execute(headers.request_id, async () => {
      const admin = this.deps.admin;
      if (admin === undefined) throw new CommercialApiError(503, 'commercial.team.not_configured', 'team administration is not configured');
      return admin.createTeam({ ...input, principal, account_id: principal.account_id, actor: actorForPrincipal(principal), request_id: commandRequestId(headers) });
    });
  }

  async createCustomRole(headers: CommercialMutationHeaders, principal: Principal, input: { readonly organization_id: string; readonly name: string; readonly permission_keys: readonly string[] }): Promise<CommercialApiEnvelope<Awaited<ReturnType<CommercialAdminService['createCustomRole']>>>> {
    return this.execute(headers.request_id, async () => {
      const admin = this.deps.admin;
      if (admin === undefined) throw new CommercialApiError(503, 'commercial.team.not_configured', 'team administration is not configured');
      return admin.createCustomRole({ ...input, principal, account_id: principal.account_id, actor: actorForPrincipal(principal), request_id: commandRequestId(headers) });
    });
  }

  async configureIdentityProvider(headers: CommercialMutationHeaders, principal: Principal, input: { readonly organization_id: string; readonly type: IdentityProvider['type']; readonly issuer?: string; readonly entity_id?: string; readonly client_id?: string }): Promise<CommercialApiEnvelope<{ readonly provider: IdentityProvider; readonly capability: ReturnType<EnterpriseSecurityService['capabilityStatus']>['sso']; readonly production_ready: boolean }>> {
    return this.execute(headers.request_id, async () => {
      const enterprise = this.deps.enterprise;
      if (enterprise === undefined) throw new CommercialApiError(503, 'commercial.sso.not_configured', 'enterprise identity is not configured');
      return enterprise.configureIdentityProvider({ ...input, principal, account_id: principal.account_id, actor: actorForPrincipal(principal), request_id: commandRequestId(headers) });
    });
  }

  async configureEnterprise(headers: CommercialMutationHeaders, principal: Principal, input: Omit<Parameters<EnterpriseSecurityService['configureEnterprise']>[0], 'principal' | 'account_id' | 'actor' | 'request_id'>): Promise<CommercialApiEnvelope<EnterpriseConfiguration>> {
    return this.execute(headers.request_id, async () => {
      const enterprise = this.deps.enterprise;
      if (enterprise === undefined) throw new CommercialApiError(503, 'commercial.enterprise_configuration.not_configured', 'enterprise configuration is not configured');
      return enterprise.configureEnterprise({ ...input, principal, account_id: principal.account_id, actor: actorForPrincipal(principal), request_id: commandRequestId(headers) });
    });
  }

  private async execute<T>(requestId: string, operation: () => Promise<T>): Promise<CommercialApiEnvelope<T>> {
    try {
      return { request_id: requestId, data: await operation() };
    } catch (error) {
      const mapped = mapCommercialApiError(error);
      return { request_id: requestId, error: { code: mapped.code, message: mapped.message, detail: mapped.detail } };
    }
  }
}

function actorForPrincipal(principal: Principal): ActorRef {
  if (principal.user_id !== undefined) return { kind: 'user', id: principal.user_id };
  if (principal.service_account_id !== undefined) return { kind: 'service_account', id: principal.service_account_id };
  return { kind: 'system', id: principal.subject_id };
}

function commandRequestId(headers: CommercialMutationHeaders): string {
  return headers.idempotency_key ?? headers.request_id;
}
