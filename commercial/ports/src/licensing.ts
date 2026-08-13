import type {
  CommercialAction,
  LicenseId,
  OfflineLicense,
  OrganizationId,
  Principal,
  CapabilityStatus,
} from '@spiderbyte/commercial-domain';

import type { CapabilityAdapter } from './platform';

export type LicenseVerificationKey = string | Uint8Array;

/** Resolves public verification keys without receiving customer data. */
export interface LicenseKeyResolver extends CapabilityAdapter {
  resolveVerificationKey(keyId: string): Promise<LicenseVerificationKey | undefined>;
}

/** Optional online authority used only for renewal; activation remains offline. */
export interface LicenseAuthorityPort extends CapabilityAdapter {
  renew(input: {
    readonly organization_id: OrganizationId;
    readonly license_id: LicenseId;
    readonly deployment_id?: string;
    readonly request_id: string;
  }): Promise<OfflineLicense | undefined>;
}

export type LicenseAction = Extract<CommercialAction, 'license.read' | 'license.manage' | 'seat.manage'>;

/** Application authorization is injected so licensing never bypasses tenancy policy. */
export interface LicenseAuthorizationPort {
  assertAuthorized(
    principal: Principal,
    organizationId: OrganizationId,
    action: LicenseAction,
    requestId: string,
  ): Promise<void>;
}

/** Narrow capability projection used by callers that expose adapter state. */
export interface LicenseCapability {
  readonly keyResolver: CapabilityStatus;
  readonly authority: CapabilityStatus | undefined;
}
