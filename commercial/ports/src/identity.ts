import type {
  AccountId,
  CapabilityStatus,
  Principal,
  UserId,
} from '@spiderbyte/commercial-domain';

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
