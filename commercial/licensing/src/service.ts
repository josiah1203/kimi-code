import { createHash, createPublicKey, verify } from 'node:crypto';

import {
  licenseActivationSchema,
  licenseSeatSchema,
  offlineLicenseSchema,
  type ActorRef,
  type LicenseActivation,
  type LicenseActivationState,
  type LicenseSeat,
  type OfflineLicense,
  type Organization,
  type OrganizationId,
  type Principal,
} from '@spiderbyte/commercial-domain';
import type {
  AuditWriter,
  Clock,
  CommercialStore,
  IdGenerator,
  LicenseAuthorityPort,
  LicenseAuthorizationPort,
  LicenseCapability,
  LicenseKeyResolver,
  LicenseVerificationKey,
} from '@spiderbyte/commercial-ports';

import { CommercialLicensingCodes, CommercialLicensingError } from './errors';

export interface LicenseDeploymentContext {
  readonly deployment_id?: string;
  readonly host_fingerprint?: string;
  readonly domain?: string;
}

export interface LicenseServiceDependencies {
  readonly store: CommercialStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly audit: AuditWriter;
  readonly keyResolver: LicenseKeyResolver;
  readonly authorization: LicenseAuthorizationPort;
  readonly authority?: LicenseAuthorityPort;
}

export interface LicenseActivationResult {
  readonly license: OfflineLicense;
  readonly activation: LicenseActivation;
  readonly state: LicenseActivationState;
}

export interface LicenseInspection {
  readonly license: OfflineLicense;
  readonly activation: LicenseActivation;
  readonly state: LicenseActivationState;
  readonly active_seat_count: number;
  readonly available_seat_count: number;
}

export interface EntitlementInspection {
  readonly organization_id: OrganizationId;
  readonly license_id: string;
  readonly plan: string;
  readonly capability: string;
  readonly enabled: boolean;
  readonly state: LicenseActivationState;
  readonly evaluated_at: string;
}

export interface LicenseRenewInput {
  readonly organization_id: OrganizationId;
  readonly license?: OfflineLicense;
  readonly deployment?: LicenseDeploymentContext;
  readonly request_id: string;
}

/**
 * Verifies the signed payload only. The signature is the sole mutable-free
 * trust input; no prompts, artifacts, credentials, or model output enter this
 * function or the key-resolver port.
 */
export function canonicalLicensePayload(license: OfflineLicense): string {
  const { signature: _signature, ...payload } = license;
  return canonicalJson(payload);
}

export function verifyOfflineLicenseSignature(
  license: OfflineLicense,
  key: LicenseVerificationKey,
): boolean {
  try {
    const publicKey = createPublicKey(typeof key === 'string' ? key : Buffer.from(key));
    return verify(
      null,
      Buffer.from(canonicalLicensePayload(license), 'utf8'),
      publicKey,
      Buffer.from(license.signature, 'base64url'),
    );
  } catch {
    return false;
  }
}

export class OfflineLicenseService {
  constructor(private readonly deps: LicenseServiceDependencies) {}

  capability(): LicenseCapability {
    return {
      keyResolver: this.deps.keyResolver.capability(),
      authority: this.deps.authority?.capability(),
    };
  }

  async activate(
    principal: Principal,
    input: {
      readonly license: OfflineLicense;
      readonly deployment?: LicenseDeploymentContext;
      readonly request_id: string;
    },
  ): Promise<LicenseActivationResult> {
    const license = offlineLicenseSchema.parse(input.license);
    const organization = await this.requireOrganization(principal, license.organization_id, 'license.manage', input.request_id);
    this.assertDeployment(license, input.deployment);

    const fingerprint = digest({
      license: canonicalLicensePayload(license),
      deployment: input.deployment,
      organization_id: organization.id,
    });
    const replay = await this.replay<LicenseActivationResult>('license.activate', input.request_id, fingerprint);
    if (replay !== undefined) return replay;

    await this.assertSignatureAvailable(license);
    const now = this.deps.clock.now();
    const state = stateAt(license, now);
    if (state === 'expired') {
      throw new CommercialLicensingError(CommercialLicensingCodes.LICENSE_EXPIRED, 'license is outside its grace period', {
        license_id: license.id,
      });
    }

    const actor = actorForPrincipal(principal);
    const activation = licenseActivationSchema.parse({
      id: this.deps.ids.next('activation_'),
      license_id: license.id,
      account_id: organization.account_id,
      organization_id: organization.id,
      state,
      activated_at: now,
      last_evaluated_at: now,
      verified_at: now,
      verification_source: 'signature',
      license_digest: digest(license),
      deployment_id: input.deployment?.deployment_id,
      version: 1,
      created_at: now,
      updated_at: now,
      created_by: actor,
      updated_by: actor,
    });
    const result = { license, activation, state } satisfies LicenseActivationResult;
    let effectiveResult = result;
    let replayed = false;

    await this.deps.store.transaction(async (store) => {
      await store.lock?.(`commercial-license-activation:${organization.id}`);
      const storedReplay = await store.get('idempotency', `license.activate:${input.request_id}`);
      if (storedReplay !== undefined) {
        if (storedReplay.fingerprint !== fingerprint) {
          throw new CommercialLicensingError(CommercialLicensingCodes.IDEMPOTENCY_REUSED, 'request id was already used for different license input');
        }
        effectiveResult = JSON.parse(storedReplay.result_json) as LicenseActivationResult;
        replayed = true;
        return;
      }
      const current = await store.list('license_activations');
      for (const existing of current.filter((candidate) =>
        candidate.account_id === organization.account_id &&
        candidate.organization_id === organization.id &&
        candidate.state !== 'revoked' &&
        candidate.id !== activation.id,
      )) {
        await store.put('license_activations', existing.id, licenseActivationSchema.parse({
          ...existing,
          state: 'revoked',
          revoked_at: now,
          version: existing.version + 1,
          updated_at: now,
          updated_by: actor,
        }));
      }
      await store.put('licenses', license.id, license);
      await store.put('license_activations', activation.id, activation);
      await this.remember(store, 'license.activate', input.request_id, fingerprint, result, now);
    });
    if (!replayed) {
      await this.audit(organization, actor, 'license.activate', license.id, input.request_id, now, {
        plan: license.plan,
        state,
        seat_count: license.seat_count,
        key_id: license.key_id,
      });
    }
    return effectiveResult;
  }

  async inspect(
    principal: Principal,
    organizationId: OrganizationId,
    requestId: string,
  ): Promise<LicenseInspection> {
    const organization = await this.requireOrganization(principal, organizationId, 'license.read', requestId);
    return this.inspectOrganization(organization, requestId);
  }

  async inspectEntitlement(
    principal: Principal,
    organizationId: OrganizationId,
    capability: string,
    requestId: string,
  ): Promise<EntitlementInspection> {
    const inspection = await this.inspect(principal, organizationId, requestId);
    const normalizedCapability = capability.trim();
    if (normalizedCapability.length === 0 || normalizedCapability.length > 200) {
      throw new CommercialLicensingError(CommercialLicensingCodes.LICENSE_NOT_FOUND, 'capability name is invalid');
    }
    return {
      organization_id: organizationId,
      license_id: inspection.license.id,
      plan: inspection.license.plan,
      capability: normalizedCapability,
      enabled: (inspection.state === 'active' || inspection.state === 'grace') &&
        inspection.license.enabled_capabilities.includes(normalizedCapability),
      state: inspection.state,
      evaluated_at: inspection.activation.last_evaluated_at,
    };
  }

  /** Fail-closed guard for commercial operations that require a license feature. */
  async assertCapability(
    principal: Principal,
    organizationId: OrganizationId,
    capability: string,
    requestId: string,
  ): Promise<void> {
    const entitlement = await this.inspectEntitlement(principal, organizationId, capability, requestId);
    if (!entitlement.enabled) {
      throw new CommercialLicensingError(CommercialLicensingCodes.CAPABILITY_NOT_INCLUDED, 'license capability is not enabled', {
        organization_id: organizationId,
        capability: entitlement.capability,
        state: entitlement.state,
      });
    }
  }

  async assignSeat(
    principal: Principal,
    input: {
      readonly organization_id: OrganizationId;
      readonly user_id: string;
      readonly request_id: string;
    },
  ): Promise<LicenseSeat> {
    const organization = await this.requireOrganization(principal, input.organization_id, 'seat.manage', input.request_id);
    const inspection = await this.inspectOrganization(organization, input.request_id);
    assertUsable(inspection.state);

    const user = await this.deps.store.get('users', input.user_id);
    if (user === undefined || user.account_id !== organization.account_id || user.state !== 'active') {
      throw new CommercialLicensingError(CommercialLicensingCodes.USER_NOT_FOUND, 'active user is not in the organization');
    }
    const memberships = await this.deps.store.list('memberships');
    if (!memberships.some((membership) =>
      membership.account_id === organization.account_id &&
      membership.organization_id === organization.id &&
      membership.user_id === user.id &&
      membership.target === 'organization' &&
      membership.state === 'active',
    )) {
      throw new CommercialLicensingError(CommercialLicensingCodes.USER_NOT_FOUND, 'user has no active organization membership');
    }

    const fingerprint = digest({ organization_id: organization.id, license_id: inspection.license.id, user_id: user.id });
    const actor = actorForPrincipal(principal);
    const replay = await this.replay<LicenseSeat>('license.seat.assign', input.request_id, fingerprint);
    if (replay !== undefined) return replay;
    let assigned: LicenseSeat | undefined;
    let replayed = false;
    await this.deps.store.transaction(async (store) => {
      await store.lock?.(`commercial-license-seat:${organization.id}:${inspection.license.id}`);
      const storedReplay = await store.get('idempotency', `license.seat.assign:${input.request_id}`);
      if (storedReplay !== undefined) {
        if (storedReplay.fingerprint !== fingerprint) {
          throw new CommercialLicensingError(CommercialLicensingCodes.IDEMPOTENCY_REUSED, 'request id was already used for different license input');
        }
        assigned = JSON.parse(storedReplay.result_json) as LicenseSeat;
        replayed = true;
        return;
      }
      const currentSeats = (await store.list('license_seats')).filter((seat) =>
        seat.account_id === organization.account_id &&
        seat.organization_id === organization.id &&
        seat.state === 'active',
      );
      const sameLicense = currentSeats.find((seat) => seat.license_id === inspection.license.id && seat.user_id === user.id);
      if (sameLicense !== undefined) {
        assigned = sameLicense;
        await this.remember(store, 'license.seat.assign', input.request_id, fingerprint, sameLicense, this.deps.clock.now());
        return;
      }
      if (currentSeats.some((seat) => seat.user_id === user.id)) {
        throw new CommercialLicensingError(CommercialLicensingCodes.USER_ALREADY_ASSIGNED, 'user already has an active license seat');
      }
      const seatsForLicense = currentSeats.filter((seat) => seat.license_id === inspection.license.id);
      if (seatsForLicense.length >= inspection.license.seat_count) {
        throw new CommercialLicensingError(CommercialLicensingCodes.SEAT_LIMIT_REACHED, 'license seat limit has been reached', {
          seat_count: inspection.license.seat_count,
        });
      }
      const now = this.deps.clock.now();
      const actor = actorForPrincipal(principal);
      const seat = licenseSeatSchema.parse({
        id: this.deps.ids.next('lseat_'),
        license_id: inspection.license.id,
        account_id: organization.account_id,
        organization_id: organization.id,
        user_id: user.id,
        state: 'active',
        assigned_at: now,
        version: 1,
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
      });
      assigned = seat;
      await store.put('license_seats', seat.id, seat);
      await this.remember(store, 'license.seat.assign', input.request_id, fingerprint, seat, now);
    });
    if (assigned === undefined) throw new Error('license seat transaction returned no result');
    const seat = assigned;
    const now = this.deps.clock.now();
    if (!replayed) {
      await this.audit(organization, actor, 'license.seat.assign', seat.id, input.request_id, now, {
        license_id: seat.license_id,
        user_id: seat.user_id,
      });
    }
    return seat;
  }

  async revokeSeat(
    principal: Principal,
    input: {
      readonly organization_id: OrganizationId;
      readonly seat_id: string;
      readonly request_id: string;
    },
  ): Promise<LicenseSeat> {
    const organization = await this.requireOrganization(principal, input.organization_id, 'seat.manage', input.request_id);
    const seat = await this.deps.store.get('license_seats', input.seat_id);
    if (seat === undefined || seat.account_id !== organization.account_id || seat.organization_id !== organization.id) {
      throw new CommercialLicensingError(CommercialLicensingCodes.SEAT_NOT_FOUND, 'license seat was not found');
    }
    const fingerprint = digest({ organization_id: organization.id, seat_id: seat.id, state: 'revoked' });
    const replay = await this.replay<LicenseSeat>('license.seat.revoke', input.request_id, fingerprint);
    if (replay !== undefined) return replay;
    if (seat.state === 'revoked') {
      await this.remember(this.deps.store, 'license.seat.revoke', input.request_id, fingerprint, seat, this.deps.clock.now());
      return seat;
    }

    const now = this.deps.clock.now();
    const actor = actorForPrincipal(principal);
    const revoked = licenseSeatSchema.parse({
      ...seat,
      state: 'revoked',
      revoked_at: now,
      version: seat.version + 1,
      updated_at: now,
      updated_by: actor,
    });
    await this.deps.store.transaction(async (store) => {
      await store.put('license_seats', revoked.id, revoked);
      await this.remember(store, 'license.seat.revoke', input.request_id, fingerprint, revoked, now);
    });
    await this.audit(organization, actor, 'license.seat.revoke', revoked.id, input.request_id, now, {
      license_id: revoked.license_id,
      user_id: revoked.user_id,
    });
    return revoked;
  }

  async renew(principal: Principal, input: LicenseRenewInput): Promise<LicenseActivationResult> {
    const organization = await this.requireOrganization(principal, input.organization_id, 'license.manage', input.request_id);
    let license = input.license;
    if (license === undefined) {
      const current = await this.currentActivation(organization);
      if (current === undefined) {
        throw new CommercialLicensingError(CommercialLicensingCodes.LICENSE_NOT_FOUND, 'there is no license to renew');
      }
      const authority = this.deps.authority;
      if (authority === undefined || authority.capability().availability !== 'available') {
        throw new CommercialLicensingError(CommercialLicensingCodes.RENEWAL_UNAVAILABLE, 'online license renewal is not configured');
      }
      license = await authority.renew({
        organization_id: organization.id,
        license_id: current.license_id,
        deployment_id: input.deployment?.deployment_id,
        request_id: input.request_id,
      });
      if (license === undefined) {
        throw new CommercialLicensingError(CommercialLicensingCodes.RENEWAL_UNAVAILABLE, 'license authority did not return a renewal');
      }
    }
    return this.activate(principal, {
      license,
      deployment: input.deployment,
      request_id: input.request_id,
    });
  }

  async revokeLicense(
    principal: Principal,
    input: {
      readonly organization_id: OrganizationId;
      readonly license_id: string;
      readonly request_id: string;
    },
  ): Promise<LicenseActivation> {
    const organization = await this.requireOrganization(principal, input.organization_id, 'license.manage', input.request_id);
    const target = (await this.deps.store.list('license_activations'))
      .filter((activation) =>
        activation.account_id === organization.account_id &&
        activation.organization_id === organization.id &&
        activation.license_id === input.license_id,
      )
      .toSorted((left, right) => {
        const leftRevoked = left.state === 'revoked' ? 1 : 0;
        const rightRevoked = right.state === 'revoked' ? 1 : 0;
        return leftRevoked - rightRevoked || Date.parse(right.activated_at) - Date.parse(left.activated_at);
      })[0];
    if (target === undefined || target.account_id !== organization.account_id || target.organization_id !== organization.id || target.license_id !== input.license_id) {
      throw new CommercialLicensingError(CommercialLicensingCodes.LICENSE_NOT_FOUND, 'license activation was not found');
    }
    const fingerprint = digest({ organization_id: organization.id, license_id: input.license_id, state: 'revoked' });
    const replay = await this.replay<LicenseActivation>('license.revoke', input.request_id, fingerprint);
    if (replay !== undefined) return replay;
    if (target.state === 'revoked') {
      await this.remember(this.deps.store, 'license.revoke', input.request_id, fingerprint, target, this.deps.clock.now());
      return target;
    }
    const now = this.deps.clock.now();
    const actor = actorForPrincipal(principal);
    const revoked = licenseActivationSchema.parse({
      ...target,
      state: 'revoked',
      revoked_at: now,
      version: target.version + 1,
      updated_at: now,
      updated_by: actor,
    });
    await this.deps.store.transaction(async (store) => {
      await store.put('license_activations', revoked.id, revoked);
      await this.remember(store, 'license.revoke', input.request_id, fingerprint, revoked, now);
    });
    await this.audit(organization, actor, 'license.revoke', revoked.license_id, input.request_id, now, {});
    return revoked;
  }

  private async inspectOrganization(organization: Organization, requestId: string): Promise<LicenseInspection> {
    const activation = await this.currentActivation(organization);
    if (activation === undefined) {
      throw new CommercialLicensingError(CommercialLicensingCodes.LICENSE_NOT_FOUND, 'no active license is installed');
    }
    const license = await this.deps.store.get('licenses', activation.license_id);
    if (license === undefined || license.organization_id !== organization.id) {
      throw new CommercialLicensingError(CommercialLicensingCodes.LICENSE_NOT_FOUND, 'license record is missing');
    }
    const verified = await this.verifyStoredLicense(license, activation);
    const now = this.deps.clock.now();
    const state = verified.valid
      ? activation.state === 'invalid' && verified.source === 'cached'
        ? 'invalid' as const
        : stateAt(license, now)
      : 'invalid' as const;
    const refreshed = licenseActivationSchema.parse({
      ...activation,
      state,
      last_evaluated_at: now,
      verification_source: verified.source,
      version: activation.version + (state === activation.state && verified.source === activation.verification_source ? 0 : 1),
      updated_at: state === activation.state && verified.source === activation.verification_source ? activation.updated_at : now,
      updated_by: state === activation.state && verified.source === activation.verification_source ? activation.updated_by : actorForOrganization(organization),
    });
    if (refreshed.last_evaluated_at !== activation.last_evaluated_at || refreshed.state !== activation.state || refreshed.verification_source !== activation.verification_source) {
      await this.deps.store.put('license_activations', refreshed.id, refreshed);
    }
    const seats = (await this.deps.store.list('license_seats')).filter((seat) =>
      seat.account_id === organization.account_id &&
      seat.organization_id === organization.id &&
      seat.license_id === license.id &&
      seat.state === 'active',
    );
    return {
      license,
      activation: refreshed,
      state,
      active_seat_count: seats.length,
      available_seat_count: Math.max(0, license.seat_count - seats.length),
    };
  }

  private async requireOrganization(
    principal: Principal,
    organizationId: OrganizationId,
    action: 'license.read' | 'license.manage' | 'seat.manage',
    requestId: string,
  ): Promise<Organization> {
    await this.deps.authorization.assertAuthorized(principal, organizationId, action, requestId);
    const organization = await this.deps.store.get('organizations', organizationId);
    if (organization === undefined || organization.account_id !== principal.account_id || organization.state !== 'active') {
      throw new CommercialLicensingError(CommercialLicensingCodes.LICENSE_ORGANIZATION_MISMATCH, 'organization is not available to this principal');
    }
    return organization;
  }

  private async currentActivation(organization: Organization): Promise<LicenseActivation | undefined> {
    const activations = (await this.deps.store.list('license_activations')).filter((activation) =>
      activation.account_id === organization.account_id &&
      activation.organization_id === organization.id &&
      activation.state !== 'revoked',
    );
    return activations.toSorted((left, right) => Date.parse(right.activated_at) - Date.parse(left.activated_at))[0];
  }

  private async assertSignatureAvailable(license: OfflineLicense): Promise<void> {
    const status = this.deps.keyResolver.capability();
    if (status.availability !== 'available') {
      throw new CommercialLicensingError(CommercialLicensingCodes.LICENSE_VERIFICATION_UNAVAILABLE, 'license verification is unavailable', {
        availability: status.availability,
      });
    }
    const key = await this.deps.keyResolver.resolveVerificationKey(license.key_id);
    if (key === undefined) {
      throw new CommercialLicensingError(CommercialLicensingCodes.LICENSE_VERIFICATION_UNAVAILABLE, 'license verification key is not configured', {
        key_id: license.key_id,
      });
    }
    if (!verifyOfflineLicenseSignature(license, key)) {
      throw new CommercialLicensingError(CommercialLicensingCodes.LICENSE_INVALID_SIGNATURE, 'license signature is invalid', {
        license_id: license.id,
      });
    }
  }

  private async verifyStoredLicense(
    license: OfflineLicense,
    activation: LicenseActivation,
  ): Promise<{ readonly valid: boolean; readonly source: 'signature' | 'cached' }> {
    const status = this.deps.keyResolver.capability();
    if (status.availability === 'temporarily_unavailable') {
      return { valid: activation.verified_at.length > 0 && activation.license_digest === digest(license), source: 'cached' };
    }
    if (status.availability !== 'available') {
      throw new CommercialLicensingError(CommercialLicensingCodes.LICENSE_VERIFICATION_UNAVAILABLE, 'license verification is unavailable', {
        availability: status.availability,
      });
    }
    const key = await this.deps.keyResolver.resolveVerificationKey(license.key_id);
    if (key === undefined) {
      throw new CommercialLicensingError(CommercialLicensingCodes.LICENSE_VERIFICATION_UNAVAILABLE, 'license verification key is not configured', {
        key_id: license.key_id,
      });
    }
    return { valid: verifyOfflineLicenseSignature(license, key), source: 'signature' };
  }

  private assertDeployment(license: OfflineLicense, deployment: LicenseDeploymentContext | undefined): void {
    const restrictions = license.deployment_restrictions;
    if (restrictions === undefined) return;
    if (restrictions.deployment_id !== undefined && restrictions.deployment_id !== deployment?.deployment_id) {
      throw new CommercialLicensingError(CommercialLicensingCodes.LICENSE_DEPLOYMENT_MISMATCH, 'license deployment restriction does not match');
    }
    if (restrictions.host_fingerprint !== undefined && restrictions.host_fingerprint.toLowerCase() !== deployment?.host_fingerprint?.toLowerCase()) {
      throw new CommercialLicensingError(CommercialLicensingCodes.LICENSE_DEPLOYMENT_MISMATCH, 'license host restriction does not match');
    }
    if (restrictions.allowed_domains !== undefined && !restrictions.allowed_domains.includes(deployment?.domain ?? '')) {
      throw new CommercialLicensingError(CommercialLicensingCodes.LICENSE_DEPLOYMENT_MISMATCH, 'license domain restriction does not match');
    }
  }

  private async replay<T>(scope: string, requestId: string, fingerprint: string): Promise<T | undefined> {
    const record = await this.deps.store.get('idempotency', `${scope}:${requestId}`);
    if (record === undefined) return undefined;
    if (record.fingerprint !== fingerprint) {
      throw new CommercialLicensingError(CommercialLicensingCodes.IDEMPOTENCY_REUSED, 'request id was already used for different license input');
    }
    return JSON.parse(record.result_json) as T;
  }

  private async remember<T>(
    store: CommercialStore,
    scope: string,
    requestId: string,
    fingerprint: string,
    result: T,
    now: string,
  ): Promise<void> {
    await store.put('idempotency', `${scope}:${requestId}`, {
      scope,
      request_id: requestId,
      fingerprint,
      result_json: JSON.stringify(result),
      created_at: now,
    });
  }

  private async audit(
    organization: Organization,
    actor: ActorRef,
    action: string,
    targetId: string,
    requestId: string,
    occurredAt: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.audit.append({
      account_id: organization.account_id,
      organization_id: organization.id,
      actor,
      action,
      target_type: action.startsWith('license.seat') ? 'license_seat' : 'license',
      target_id: targetId,
      outcome: 'succeeded',
      request_id: requestId,
      occurred_at: occurredAt,
      detail,
    });
  }
}

function stateAt(license: OfflineLicense, now: string): Exclude<LicenseActivationState, 'revoked' | 'invalid'> {
  const current = Date.parse(now);
  const issued = Date.parse(license.issued_at);
  const expires = Date.parse(license.expires_at);
  if (current < issued) {
    throw new CommercialLicensingError(CommercialLicensingCodes.LICENSE_NOT_YET_VALID, 'license has not reached its issued-at time');
  }
  if (current <= expires) return 'active';
  const graceEnd = expires + license.grace_period_days * 24 * 60 * 60 * 1000;
  return current <= graceEnd ? 'grace' : 'expired';
}

function assertUsable(state: LicenseActivationState): void {
  if (state === 'expired') {
    throw new CommercialLicensingError(CommercialLicensingCodes.LICENSE_EXPIRED, 'license is outside its grace period');
  }
  if (state === 'revoked' || state === 'invalid') {
    throw new CommercialLicensingError(CommercialLicensingCodes.LICENSE_REVOKED, 'license is not usable');
  }
}

function actorForPrincipal(principal: Principal): ActorRef {
  if (principal.user_id !== undefined) return { kind: 'user', id: principal.user_id };
  if (principal.service_account_id !== undefined) return { kind: 'service_account', id: principal.service_account_id };
  return { kind: 'system', id: principal.subject_id };
}

function actorForOrganization(organization: Organization): ActorRef {
  return { kind: 'system', id: `license-evaluator:${organization.id}` };
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}
