import type {
  AccountId,
  CapabilityStatus,
  OrganizationId,
  Principal,
  UserId,
} from '@spiderbyte/commercial-domain';
import type { CapabilityAdapter } from './platform';

export type ExternalIdentityMemberRole = 'owner' | 'admin' | 'member' | 'viewer';
export type ExternalIdentityMemberState = 'invited' | 'active' | 'suspended' | 'removed';

/** A provider-normalized user snapshot used only at the synchronization boundary. */
export interface ExternalIdentityMember {
  readonly user_id: UserId;
  readonly email: string;
  readonly display_name: string;
  readonly role: ExternalIdentityMemberRole;
  readonly state: ExternalIdentityMemberState;
}

/**
 * A complete organization snapshot from a trusted identity provider.
 * Provider adapters map external identifiers to stable commercial identifiers;
 * the application service owns persistence, authorization, and audit effects.
 */
export interface ExternalIdentityOrganizationSnapshot {
  readonly provider: string;
  readonly external_organization_id: string;
  readonly account_id: AccountId;
  readonly organization_id: OrganizationId;
  readonly name: string;
  readonly owner_user_id: UserId;
  readonly members: readonly ExternalIdentityMember[];
}

/** Optional read/synchronization capability implemented by hosted identity adapters. */
export interface ExternalIdentityDirectoryPort extends CapabilityAdapter {
  getOrganizationSnapshot(externalOrganizationId: string): Promise<ExternalIdentityOrganizationSnapshot | undefined>;
  listOrganizationSnapshots(principal: Principal): Promise<readonly ExternalIdentityOrganizationSnapshot[]>;
}

export interface IdentityRegistrationInput {
  readonly account_id: AccountId;
  readonly user_id: UserId;
  readonly email: string;
  readonly display_name: string;
  /** Secret material is consumed by the adapter and must never be persisted by the application. */
  readonly secret?: string;
}

export interface IdentityRegistration {
  readonly provider_subject: string;
  readonly auth_method: 'oidc' | 'saml' | 'password' | 'development';
}

export interface IdentityAuthentication {
  readonly principal: Principal;
  readonly session_token: string;
  readonly expires_at: string;
}

export interface IdentityAuthenticationInput {
  readonly email: string;
  readonly secret?: string;
  readonly external_token?: string;
}

export interface IdentityPort {
  readonly adapter_name: string;
  capability(): CapabilityStatus;
  register(input: IdentityRegistrationInput): Promise<IdentityRegistration>;
  authenticate(input: IdentityAuthenticationInput): Promise<IdentityAuthentication | undefined>;
  validateSession(token: string): Promise<Principal | undefined>;
  revokeSession(sessionId: string): Promise<void>;
}
