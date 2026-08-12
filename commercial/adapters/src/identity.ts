import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import {
  capabilityStatusSchema,
  nowIsoDateTime,
  principalSchema,
  type CapabilityStatus,
  type Principal,
} from '@spiderbyte/commercial-domain';
import {
  CapabilityUnavailableError,
  type Clock,
  type IdentityAuthentication,
  type IdentityAuthenticationInput,
  type IdentityPort,
  type IdentityRegistration,
  type IdentityRegistrationInput,
  type TokenGenerator,
} from '@spiderbyte/commercial-ports';

const scrypt = promisify(scryptCallback);

interface CredentialRecord {
  readonly account_id: string;
  readonly user_id: string;
  readonly email: string;
  readonly display_name: string;
  readonly salt: Buffer;
  readonly hash: Buffer;
}

interface SessionRecord {
  readonly principal: Principal;
  readonly expires_at: string;
}

export interface DevelopmentIdentityAdapterOptions {
  readonly environment: 'development';
  readonly clock: Clock;
  readonly tokenGenerator: TokenGenerator;
  readonly sessionTtlMs?: number;
}

/**
 * Explicit test/local-development identity. It cannot be constructed with a
 * production environment and is never selected by the hosted API implicitly.
 */
export class DevelopmentIdentityAdapter implements IdentityPort {
  readonly adapter_name = 'development-identity';
  private readonly credentials = new Map<string, CredentialRecord>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly ttlMs: number;

  constructor(private readonly options: DevelopmentIdentityAdapterOptions) {
    if (options.environment !== 'development') {
      throw new Error('DevelopmentIdentityAdapter is only valid in development mode');
    }
    this.ttlMs = options.sessionTtlMs ?? 60 * 60 * 1000;
    if (!Number.isInteger(this.ttlMs) || this.ttlMs < 60_000) {
      throw new RangeError('development session TTL must be at least one minute');
    }
  }

  capability(): CapabilityStatus {
    return capabilityStatusSchema.parse({
      capability: 'identity',
      availability: 'available',
      adapter: this.adapter_name,
      reason: 'explicit development identity adapter',
      checked_at: this.options.clock.now(),
    });
  }

  async register(input: IdentityRegistrationInput): Promise<IdentityRegistration> {
    const email = input.email.trim().toLowerCase();
    if (this.credentials.has(email)) {
      throw new Error('identity account already exists');
    }
    if (input.secret === undefined || input.secret.length < 12) {
      throw new Error('development identity secret must contain at least 12 characters');
    }
    const salt = randomBytes(16);
    const hash = await deriveSecret(input.secret, salt, 32);
    this.credentials.set(email, {
      account_id: input.account_id,
      user_id: input.user_id,
      email,
      display_name: input.display_name,
      salt,
      hash,
    });
    return { provider_subject: `dev:${input.user_id}`, auth_method: 'development' };
  }

  async authenticate(input: IdentityAuthenticationInput): Promise<IdentityAuthentication | undefined> {
    const record = this.credentials.get(input.email.trim().toLowerCase());
    if (record === undefined || input.secret === undefined) return undefined;
    const candidate = await deriveSecret(input.secret, record.salt, record.hash.length);
    if (candidate.length !== record.hash.length || !timingSafeEqual(candidate, record.hash)) return undefined;

    const issuedAt = this.options.clock.now();
    const expiresAt = new Date(Date.parse(issuedAt) + this.ttlMs).toISOString();
    const token = this.options.tokenGenerator.token(32);
    const principal = principalSchema.parse({
      subject_id: record.user_id,
      account_id: record.account_id,
      user_id: record.user_id,
      session_id: `ses_${this.options.tokenGenerator.token(16)}`,
      organization_ids: [],
      scopes: ['identity:read'],
      auth_method: 'development',
      issued_at: issuedAt,
      expires_at: expiresAt,
    });
    this.sessions.set(hashToken(token), { principal, expires_at: expiresAt });
    return { principal, session_token: token, expires_at: expiresAt };
  }

  async validateSession(token: string): Promise<Principal | undefined> {
    const record = this.sessions.get(hashToken(token));
    if (record === undefined) return undefined;
    if (Date.parse(record.expires_at) <= Date.parse(this.options.clock.now())) {
      this.sessions.delete(hashToken(token));
      return undefined;
    }
    return record.principal;
  }

  async revokeSession(sessionId: string): Promise<void> {
    for (const [tokenHash, record] of this.sessions) {
      if (record.principal.session_id === sessionId) this.sessions.delete(tokenHash);
    }
  }
}

export class UnavailableIdentityAdapter implements IdentityPort {
  readonly adapter_name = 'unavailable-identity';

  constructor(
    private readonly availability: 'not_configured' | 'temporarily_unavailable' | 'not_implemented' = 'not_configured',
    private readonly reason = 'a production identity provider is not configured',
  ) {}

  capability(): CapabilityStatus {
    return capabilityStatusSchema.parse({
      capability: 'identity',
      availability: this.availability,
      adapter: this.adapter_name,
      reason: this.reason,
      checked_at: nowIsoDateTime(),
    });
  }

  async register(_input: IdentityRegistrationInput): Promise<IdentityRegistration> {
    throw new CapabilityUnavailableError(this.capability());
  }

  async authenticate(_input: IdentityAuthenticationInput): Promise<IdentityAuthentication | undefined> {
    throw new CapabilityUnavailableError(this.capability());
  }

  async validateSession(_token: string): Promise<Principal | undefined> {
    throw new CapabilityUnavailableError(this.capability());
  }

  async revokeSession(_sessionId: string): Promise<void> {
    throw new CapabilityUnavailableError(this.capability());
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function deriveSecret(secret: string, salt: Buffer, length: number): Promise<Buffer> {
  const derived = await scrypt(secret, salt, length);
  return Buffer.from(derived as Buffer);
}
