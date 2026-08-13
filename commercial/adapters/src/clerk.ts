import { createHash } from 'node:crypto';

import { createClerkClient, verifyToken } from '@clerk/backend';
import {
  capabilityStatusSchema,
  nowIsoDateTime,
  organizationIdSchema,
  principalSchema,
  type CapabilityStatus,
  type Principal,
} from '@spiderbyte/commercial-domain';
import {
  CapabilityUnavailableError,
  type Clock,
  type HostedBillingPlan,
  type HostedBillingPayer,
  type HostedBillingPort,
  type HostedBillingSubscription,
  type HostedBillingSubscriptionState,
  type IdentityAuthentication,
  type IdentityAuthenticationInput,
  type IdentityPort,
  type IdentityRegistration,
  type IdentityRegistrationInput,
} from '@spiderbyte/commercial-ports';

const defaultClock: Clock = { now: nowIsoDateTime };
const DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1000;

type ClerkServerClient = {
  readonly sessions: {
    revokeSession(sessionId: string): Promise<unknown>;
  };
  readonly billing: {
    getOrganizationBillingSubscription(organizationId: string): Promise<unknown>;
    getUserBillingSubscription(userId: string): Promise<unknown>;
    getPlanList(input: { readonly payerType: 'org' | 'user' }): Promise<unknown>;
  };
};

export interface ClerkIdentityAdapterOptions {
  /** Server-only Clerk secret. Never pass this to browser code or persist it. */
  readonly secretKey?: string;
  readonly jwtKey?: string;
  readonly authorizedParties?: readonly string[];
  readonly clock?: Clock;
}

/**
 * Clerk-backed identity verification for the hosted commercial boundary.
 * Signup and sign-in are intentionally owned by Clerk's UI; this adapter
 * verifies the resulting bearer token and translates its claims to local IDs.
 */
export class ClerkIdentityAdapter implements IdentityPort {
  readonly adapter_name = 'clerk-identity';
  private readonly clock: Clock;

  constructor(private readonly options: ClerkIdentityAdapterOptions = {}) {
    this.clock = options.clock ?? defaultClock;
  }

  capability(): CapabilityStatus {
    return capabilityStatusSchema.parse({
      capability: 'identity',
      availability: this.options.secretKey === undefined ? 'not_configured' : 'available',
      adapter: this.adapter_name,
      reason: this.options.secretKey === undefined
        ? 'CLERK_SECRET_KEY is required for hosted token verification'
        : 'Clerk verifies hosted sessions; SpiderByte maps claims to commercial principals',
      checked_at: this.clock.now(),
    });
  }

  async register(input: IdentityRegistrationInput): Promise<IdentityRegistration> {
    this.assertConfigured();
    // Clerk owns the actual sign-up flow. This operation only records the
    // provider-neutral association when a local account is provisioned from a
    // trusted webhook or hosted control-plane workflow.
    return { provider_subject: input.user_id, auth_method: 'oidc' };
  }

  async authenticate(input: IdentityAuthenticationInput): Promise<IdentityAuthentication | undefined> {
    if (input.external_token === undefined) return undefined;
    const principal = await this.validateSession(input.external_token);
    if (principal === undefined) return undefined;
    return {
      principal,
      session_token: input.external_token,
      expires_at: principal.expires_at,
    };
  }

  async validateSession(token: string): Promise<Principal | undefined> {
    this.assertConfigured();
    try {
      const verified = await verifyToken(token, {
        secretKey: this.options.secretKey,
        jwtKey: this.options.jwtKey,
        authorizedParties: this.options.authorizedParties === undefined
          ? undefined
          : [...this.options.authorizedParties],
      });
      return principalFromClaims(tokenClaims(verified), this.clock.now());
    } catch {
      return undefined;
    }
  }

  async revokeSession(sessionId: string): Promise<void> {
    this.assertConfigured();
    const externalSessionId = sessionId.startsWith('ses_') ? sessionId.slice('ses_'.length) : sessionId;
    await clerkServerClient(this.options.secretKey).sessions.revokeSession(externalSessionId);
  }

  private assertConfigured(): void {
    if (this.options.secretKey === undefined) {
      throw new CapabilityUnavailableError(this.capability());
    }
  }
}

export interface ClerkBillingAdapterOptions {
  /** Server-only Clerk secret. Never pass this to browser code or persist it. */
  readonly secretKey?: string;
  readonly clock?: Clock;
}

/**
 * Read-only Clerk Billing adapter. Clerk owns checkout and payment mutations;
 * SpiderByte can use this boundary to reconcile local plans and entitlements.
 */
export class ClerkBillingAdapter implements HostedBillingPort {
  readonly adapter_name = 'clerk-billing';
  private readonly clock: Clock;

  constructor(private readonly options: ClerkBillingAdapterOptions = {}) {
    this.clock = options.clock ?? defaultClock;
  }

  capability(): CapabilityStatus {
    return capabilityStatusSchema.parse({
      capability: 'payment',
      availability: this.options.secretKey === undefined ? 'not_configured' : 'available',
      adapter: this.adapter_name,
      reason: this.options.secretKey === undefined
        ? 'CLERK_SECRET_KEY is required for hosted billing reads'
        : 'Clerk Billing provides hosted plans and subscription state; SpiderByte owns local entitlements',
      checked_at: this.clock.now(),
    });
  }

  async getOrganizationSubscription(organizationId: string): Promise<HostedBillingSubscription | undefined> {
    this.assertConfigured();
    try {
      const raw = await this.client().billing.getOrganizationBillingSubscription(organizationId);
      return normalizeSubscription(raw, 'organization', organizationId);
    } catch (error) {
      if (isNotFoundError(error)) return undefined;
      throw error;
    }
  }

  async getUserSubscription(userId: string): Promise<HostedBillingSubscription | undefined> {
    this.assertConfigured();
    try {
      const raw = await this.client().billing.getUserBillingSubscription(userId);
      return normalizeSubscription(raw, 'user', userId);
    } catch (error) {
      if (isNotFoundError(error)) return undefined;
      throw error;
    }
  }

  async listPlans(payer: HostedBillingPayer): Promise<readonly HostedBillingPlan[]> {
    this.assertConfigured();
    const raw = await this.client().billing.getPlanList({ payerType: payer === 'organization' ? 'org' : 'user' });
    const collection = Array.isArray(raw) ? raw : asArray(asRecord(raw)['data']);
    return collection
      .map((item) => normalizePlan(item, payer))
      .filter((plan): plan is HostedBillingPlan => plan !== undefined);
  }

  private client(): ClerkServerClient {
    return clerkServerClient(this.options.secretKey);
  }

  private assertConfigured(): void {
    if (this.options.secretKey === undefined) {
      throw new CapabilityUnavailableError(this.capability());
    }
  }
}

function clerkServerClient(secretKey: string | undefined): ClerkServerClient {
  return createClerkClient({ secretKey }) as unknown as ClerkServerClient;
}

function principalFromClaims(claims: Record<string, unknown>, now: string): Principal | undefined {
  const subject = stringClaim(claims, 'sub');
  if (subject === undefined) return undefined;

  const issuedAt = epochToIso(numberClaim(claims, 'iat'), now);
  const expiresAt = epochToIso(
    numberClaim(claims, 'exp'),
    new Date(Date.parse(now) + DEFAULT_TOKEN_TTL_MS).toISOString(),
  );
  const organizationClaim = stringClaim(claims, 'org_id') ?? stringClaim(claims, 'orgId');
  const organizationId = organizationClaim === undefined
    ? undefined
    : organizationIdSchema.safeParse(organizationClaim).success
      ? organizationClaim
      : hashedId('org_clerk_', organizationClaim);
  const scopeClaim = stringClaim(claims, 'scope') ?? stringClaim(claims, 'scp');
  const externalSessionId = stringClaim(claims, 'sid');
  const scopes = [
    'identity:read',
    ...(scopeClaim === undefined ? [] : scopeClaim.split(/\s+/).filter(Boolean)),
    ...stringArrayClaim(claims, 'scopes'),
  ].filter((scope, index, values) => values.indexOf(scope) === index);

  return principalSchema.parse({
    subject_id: hashedId('clerk_', subject),
    account_id: hashedId('acct_clerk_', subject),
    user_id: hashedId('usr_clerk_', subject),
    session_id: externalSessionId === undefined ? undefined : `ses_${externalSessionId}`,
    organization_ids: organizationId === undefined ? [] : [organizationId],
    scopes,
    auth_method: 'session',
    issued_at: issuedAt,
    expires_at: expiresAt,
  });
}

function tokenClaims(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  const data = asRecord(record['data']);
  return Object.keys(data).length === 0 ? record : data;
}

function normalizeSubscription(
  value: unknown,
  payer: HostedBillingPayer,
  payerId: string,
): HostedBillingSubscription | undefined {
  const record = asRecord(asRecord(value)['data'] ?? value);
  const plan = asRecord(record['plan'] ?? record['plan_info']);
  const externalId = firstString(record['id'], record['subscription_id'], record['subscriptionId']);
  const planId = firstString(plan['id'], plan['plan_id'], record['plan_id'], record['planId']);
  if (externalId === undefined || planId === undefined) return undefined;

  return {
    provider: 'clerk',
    external_id: externalId,
    payer,
    payer_id: payerId,
    plan_id: planId,
    plan_slug: firstString(plan['slug'], plan['code'], record['plan_slug'], record['planSlug']) ?? planId,
    plan_name: firstString(plan['name'], record['plan_name'], record['planName']) ?? planId,
    state: normalizeSubscriptionState(firstString(record['status'], record['state'], record['subscription_status'])),
    period_start: timestampToIso(record['period_start'] ?? record['periodStart'] ?? record['current_period_start']),
    period_end: timestampToIso(record['period_end'] ?? record['periodEnd'] ?? record['current_period_end']),
  };
}

function normalizePlan(value: unknown, payer: HostedBillingPayer): HostedBillingPlan | undefined {
  const record = asRecord(value);
  const externalId = firstString(record['id'], record['plan_id'], record['planId']);
  const slug = firstString(record['slug'], record['code'], record['key']);
  const name = firstString(record['name'], record['display_name'], record['displayName']);
  if (externalId === undefined || slug === undefined || name === undefined) return undefined;

  const monthly = asRecord(record['monthly_price'] ?? record['monthlyPrice']);
  const annual = asRecord(record['annual_price'] ?? record['annualPrice']);
  const features = asArray(record['features'])
    .map((feature) => typeof feature === 'string' ? feature : firstString(asRecord(feature)['name'], asRecord(feature)['slug']))
    .filter((feature): feature is string => feature !== undefined);

  return {
    provider: 'clerk',
    external_id: externalId,
    slug,
    name,
    payer,
    description: firstString(record['description']),
    monthly_amount_minor: numberClaim(monthly, 'amount') ?? numberClaim(record, 'monthly_amount_minor'),
    annual_amount_minor: numberClaim(annual, 'amount') ?? numberClaim(record, 'annual_amount_minor'),
    currency: firstString(monthly['currency'], annual['currency'], record['currency']),
    features,
  };
}

function normalizeSubscriptionState(value: string | undefined): HostedBillingSubscriptionState {
  switch (value) {
    case 'active':
    case 'past_due':
    case 'canceled':
    case 'ended':
    case 'incomplete':
    case 'abandoned':
      return value;
    default:
      return 'unknown';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringClaim(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stringArrayClaim(record: Record<string, unknown>, key: string): readonly string[] {
  return asArray(record[key]).filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function numberClaim(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

function epochToIso(value: number | undefined, fallback: string): string {
  return value === undefined ? fallback : new Date(value * 1000).toISOString();
}

function timestampToIso(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  }
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return undefined;
}

function hashedId(prefix: string, value: string): string {
  return `${prefix}${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

function isNotFoundError(value: unknown): boolean {
  const record = asRecord(value);
  return record['status'] === 404 || record['statusCode'] === 404 || record['code'] === 'not_found';
}
