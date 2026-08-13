import { createHash } from 'node:crypto';

import { createClerkClient, verifyToken } from '@clerk/backend';
import {
  capabilityStatusSchema,
  nowIsoDateTime,
  type AccountId,
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
  type ExternalIdentityDirectoryPort,
  type ExternalIdentityOrganizationSnapshot,
  type IdentityAuthentication,
  type IdentityAuthenticationInput,
  type IdentityPort,
  type IdentityRegistration,
  type IdentityRegistrationInput,
} from '@spiderbyte/commercial-ports';

const defaultClock: Clock = { now: nowIsoDateTime };
const DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1000;
const CLERK_MEMBERSHIP_PAGE_SIZE = 500;
const CLERK_MAX_MEMBERSHIP_PAGES = 100;

type ClerkServerClient = {
  readonly users: {
    getUser(userId: string): Promise<unknown>;
  };
  readonly organizations: {
    getOrganization(input: { readonly organizationId: string }): Promise<unknown>;
    getOrganizationMembershipList(input: { readonly organizationId: string; readonly limit?: number; readonly offset?: number }): Promise<unknown>;
  };
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
  /** Stable commercial account representing the Clerk instance/tenant. */
  readonly accountId?: AccountId;
  readonly clock?: Clock;
}

/**
 * Clerk-backed identity verification for the hosted commercial boundary.
 * Signup and sign-in are intentionally owned by Clerk's UI; this adapter
 * verifies the resulting bearer token and translates its claims to local IDs.
 */
export class ClerkIdentityAdapter implements IdentityPort, ExternalIdentityDirectoryPort {
  readonly adapter_name = 'clerk-identity';
  private readonly clock: Clock;

  constructor(private readonly options: ClerkIdentityAdapterOptions = {}) {
    this.clock = options.clock ?? defaultClock;
  }

  capability(): CapabilityStatus {
    const configured = this.hasSecretKey() && this.options.accountId !== undefined;
    return capabilityStatusSchema.parse({
      capability: 'identity',
      availability: configured ? 'available' : 'not_configured',
      adapter: this.adapter_name,
      reason: !this.hasSecretKey()
        ? 'CLERK_SECRET_KEY is required for hosted token verification'
        : this.options.accountId === undefined
          ? 'a stable commercial account_id is required before hosted Clerk membership synchronization'
          : 'Clerk verifies hosted sessions; SpiderByte maps claims and synchronized memberships to commercial principals',
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
      return principalFromClaims(tokenClaims(verified), this.clock.now(), this.options.accountId);
    } catch {
      return undefined;
    }
  }

  async getOrganizationSnapshot(externalOrganizationId: string): Promise<ExternalIdentityOrganizationSnapshot | undefined> {
    this.assertConfigured();
    if (this.options.accountId === undefined) throw new CapabilityUnavailableError(this.capability());
    try {
      const rawOrganization = await this.client().organizations.getOrganization({ organizationId: externalOrganizationId });
      const organizationRecord = asRecord(rawOrganization);
      const organization = asRecord(organizationRecord['data'] ?? rawOrganization);
      const ownerExternalId = firstIdentifier(
        organization['created_by'],
        organization['createdBy'],
        organization['created_by_user_id'],
        organization['owner_id'],
        organization['ownerId'],
      );
      const organizationName = firstString(organization['name'], organization['slug']) ?? externalOrganizationId;
      if (ownerExternalId === undefined) throw new Error('Clerk organization does not expose an owner identifier');

      const membershipValues: unknown[] = [];
      for (let page = 0; page < CLERK_MAX_MEMBERSHIP_PAGES; page += 1) {
        const rawMemberships = await this.client().organizations.getOrganizationMembershipList({
          organizationId: externalOrganizationId,
          limit: CLERK_MEMBERSHIP_PAGE_SIZE,
          offset: page * CLERK_MEMBERSHIP_PAGE_SIZE,
        });
        const membershipRecord = asRecord(rawMemberships);
        const values = asArray(membershipRecord['data'] ?? rawMemberships);
        membershipValues.push(...values);
        if (values.length < CLERK_MEMBERSHIP_PAGE_SIZE) break;
        if (page === CLERK_MAX_MEMBERSHIP_PAGES - 1) throw new Error('Clerk organization membership snapshot exceeds the synchronization limit');
      }
      const members: ExternalIdentityOrganizationSnapshot['members'][number][] = [];
      for (const value of membershipValues) {
        const membership = asRecord(value);
        const publicUser = asRecord(membership['public_user_data'] ?? membership['publicUserData']);
        const externalUserId = firstIdentifier(
          publicUser['user_id'],
          publicUser['id'],
          membership['user_id'],
          membership['userId'],
        );
        if (externalUserId === undefined) throw new Error('Clerk organization membership does not expose a user identifier');
        const rawUser = asRecord(await this.client().users.getUser(externalUserId));
        const user = asRecord(rawUser['data'] ?? rawUser);
        const email = firstString(
          publicUser['identifier'],
          userEmail(user),
        );
        if (email === undefined) throw new Error('Clerk organization membership user does not expose an email address');
        const role = externalUserId === ownerExternalId
          ? 'owner'
          : normalizeClerkRole(firstString(membership['role'], membership['role_name'], membership['roleName']));
        members.push({
          user_id: hashedId('usr_clerk_', externalUserId),
          email,
          display_name: displayName(user, publicUser, email),
          role,
          state: normalizeClerkMembershipState(firstString(membership['status'], membership['state'])),
        });
      }
      return {
        provider: 'clerk',
        external_organization_id: externalOrganizationId,
        account_id: this.options.accountId,
        organization_id: mappedOrganizationId(externalOrganizationId),
        name: organizationName,
        owner_user_id: hashedId('usr_clerk_', ownerExternalId),
        members,
      } satisfies ExternalIdentityOrganizationSnapshot;
    } catch (error) {
      if (isNotFoundError(error)) return undefined;
      throw error;
    }
  }

  async listOrganizationSnapshots(principal: Principal): Promise<readonly ExternalIdentityOrganizationSnapshot[]> {
    this.assertConfigured();
    if (this.options.accountId === undefined) throw new CapabilityUnavailableError(this.capability());

    const snapshots: ExternalIdentityOrganizationSnapshot[] = [];
    for (const organizationId of principal.organization_ids) {
      // Normalized IDs with this prefix were generated for non-standard
      // provider identifiers and cannot be reversed into a Clerk ID. Clerk's
      // native organization IDs are already in the org_* form.
      if (organizationId.startsWith('org_clerk_')) continue;
      const snapshot = await this.getOrganizationSnapshot(organizationId);
      if (snapshot !== undefined) snapshots.push(snapshot);
    }
    return snapshots;
  }

  async revokeSession(sessionId: string): Promise<void> {
    this.assertConfigured();
    const externalSessionId = sessionId.startsWith('ses_') ? sessionId.slice('ses_'.length) : sessionId;
    await this.client().sessions.revokeSession(externalSessionId);
  }

  private client(): ClerkServerClient {
    return clerkServerClient(this.options.secretKey);
  }

  private assertConfigured(): void {
    if (!this.hasSecretKey()) {
      throw new CapabilityUnavailableError(this.capability());
    }
  }

  private hasSecretKey(): boolean {
    return this.options.secretKey !== undefined && this.options.secretKey.length > 0;
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
      availability: this.options.secretKey === undefined || this.options.secretKey.length === 0 ? 'not_configured' : 'available',
      adapter: this.adapter_name,
      reason: this.options.secretKey === undefined || this.options.secretKey.length === 0
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
    if (this.options.secretKey === undefined || this.options.secretKey.length === 0) {
      throw new CapabilityUnavailableError(this.capability());
    }
  }
}

function clerkServerClient(secretKey: string | undefined): ClerkServerClient {
  return createClerkClient({ secretKey }) as unknown as ClerkServerClient;
}

function principalFromClaims(claims: Record<string, unknown>, now: string, accountId?: AccountId): Principal | undefined {
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
    : mappedOrganizationId(organizationClaim);
  const scopeClaim = stringClaim(claims, 'scope') ?? stringClaim(claims, 'scp');
  const externalSessionId = stringClaim(claims, 'sid');
  const scopes = [
    'identity:read',
    ...(scopeClaim === undefined ? [] : scopeClaim.split(/\s+/).filter(Boolean)),
    ...stringArrayClaim(claims, 'scopes'),
  ].filter((scope, index, values) => values.indexOf(scope) === index);

  return principalSchema.parse({
    subject_id: hashedId('clerk_', subject),
    account_id: accountId ?? hashedId('acct_clerk_', subject),
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

function firstIdentifier(...values: unknown[]): string | undefined {
  for (const value of values) {
    const direct = firstString(value);
    if (direct !== undefined) return direct;
    const record = asRecord(value);
    const nested = firstString(record['id'], record['user_id'], record['userId'], record['external_id']);
    if (nested !== undefined) return nested;
  }
  return undefined;
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

function userEmail(user: Record<string, unknown>): string | undefined {
  const addresses = asArray(user['email_addresses']);
  for (const value of addresses) {
    const address = asRecord(value);
    const email = firstString(address['email_address'], address['emailAddress']);
    if (email !== undefined) return email;
  }
  return firstString(user['email'], user['primary_email_address']);
}

function displayName(
  user: Record<string, unknown>,
  publicUser: Record<string, unknown>,
  fallback: string,
): string {
  const first = firstString(user['first_name'], publicUser['first_name'], publicUser['firstName']);
  const last = firstString(user['last_name'], publicUser['last_name'], publicUser['lastName']);
  const combined = [first, last].filter((value): value is string => value !== undefined).join(' ').trim();
  return combined.length > 0
    ? combined
    : firstString(user['username'], publicUser['identifier']) ?? fallback;
}

function normalizeClerkRole(value: string | undefined): ExternalIdentityOrganizationSnapshot['members'][number]['role'] {
  if (value === 'org:admin' || value === 'admin' || value?.endsWith(':admin') === true) return 'admin';
  if (value === 'viewer' || value?.endsWith(':viewer') === true) return 'viewer';
  return 'member';
}

function normalizeClerkMembershipState(value: string | undefined): ExternalIdentityOrganizationSnapshot['members'][number]['state'] {
  switch (value) {
    case 'pending':
    case 'invited':
      return 'invited';
    case 'suspended':
      return 'suspended';
    case 'removed':
    case 'revoked':
    case 'inactive':
      return 'removed';
    default:
      return 'active';
  }
}

function hashedId(prefix: string, value: string): string {
  return `${prefix}${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

function mappedOrganizationId(externalOrganizationId: string): string {
  return organizationIdSchema.safeParse(externalOrganizationId).success
    ? externalOrganizationId
    : hashedId('org_clerk_', externalOrganizationId);
}

function isNotFoundError(value: unknown): boolean {
  const record = asRecord(value);
  return record['status'] === 404 || record['statusCode'] === 404 || record['code'] === 'not_found';
}
