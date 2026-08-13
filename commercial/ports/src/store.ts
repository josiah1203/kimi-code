import type {
  Account,
  ApiKey,
  Allowance,
  AuditEvent,
  BillingPeriod,
  Budget,
  CreditBalance,
  ComputeExecution,
  ComputeProvider,
  ComputeRegion,
  ComputeReservation,
  Entitlement,
  Group,
  HostedArtifact,
  IdentityProvider,
  Invoice,
  Invitation,
  LicenseActivation,
  LicenseSeat,
  OfflineLicense,
  JobClass,
  LegalHold,
  LedgerEntry,
  Membership,
  Organization,
  PaymentStatus,
  Plan,
  Quota,
  Role,
  RetentionPolicy,
  ServiceAccount,
  Session,
  SpendLimit,
  Subscription,
  Team,
  User,
  UsageEvent,
  VerifiedDomain,
  EnterpriseConfiguration,
  WebhookEndpoint,
  OrganizationPolicy,
  SupportAccessGrant,
  Workspace,
} from '@spiderbyte/commercial-domain';

export type CommercialCollection =
  | 'accounts'
  | 'users'
  | 'sessions'
  | 'organizations'
  | 'workspaces'
  | 'teams'
  | 'groups'
  | 'roles'
  | 'memberships'
  | 'invitations'
  | 'service_accounts'
  | 'api_keys'
  | 'plans'
  | 'subscriptions'
  | 'entitlements'
  | 'quotas'
  | 'allowances'
  | 'budgets'
  | 'spend_limits'
  | 'usage_events'
  | 'ledger_entries'
  | 'billing_periods'
  | 'invoices'
  | 'payment_status'
  | 'credit_balances'
  | 'compute_providers'
  | 'compute_regions'
  | 'job_classes'
  | 'compute_reservations'
  | 'compute_executions'
  | 'hosted_artifacts'
  | 'retention_policies'
  | 'legal_holds'
  | 'organization_policies'
  | 'support_grants'
  | 'webhook_endpoints'
  | 'identity_providers'
  | 'verified_domains'
  | 'enterprise_configurations'
  | 'audit_events'
  | 'licenses'
  | 'license_activations'
  | 'license_seats'
  | 'idempotency';

export interface CommercialCollectionTypes {
  accounts: Account;
  users: User;
  sessions: Session;
  organizations: Organization;
  workspaces: Workspace;
  teams: Team;
  groups: Group;
  roles: Role;
  memberships: Membership;
  invitations: Invitation;
  service_accounts: ServiceAccount;
  api_keys: ApiKey;
  plans: Plan;
  subscriptions: Subscription;
  entitlements: Entitlement;
  quotas: Quota;
  allowances: Allowance;
  budgets: Budget;
  spend_limits: SpendLimit;
  usage_events: UsageEvent;
  ledger_entries: LedgerEntry;
  billing_periods: BillingPeriod;
  invoices: Invoice;
  payment_status: PaymentStatus;
  credit_balances: CreditBalance;
  compute_providers: ComputeProvider;
  compute_regions: ComputeRegion;
  job_classes: JobClass;
  compute_reservations: ComputeReservation;
  compute_executions: ComputeExecution;
  hosted_artifacts: HostedArtifact;
  retention_policies: RetentionPolicy;
  legal_holds: LegalHold;
  organization_policies: OrganizationPolicy;
  support_grants: SupportAccessGrant;
  webhook_endpoints: WebhookEndpoint;
  identity_providers: IdentityProvider;
  verified_domains: VerifiedDomain;
  enterprise_configurations: EnterpriseConfiguration;
  audit_events: AuditEvent;
  idempotency: IdempotencyRecord;
  licenses: OfflineLicense;
  license_activations: LicenseActivation;
  license_seats: LicenseSeat;
}

export interface IdempotencyRecord {
  readonly scope: string;
  readonly request_id: string;
  readonly fingerprint: string;
  readonly result_json: string;
  readonly created_at: string;
}

export interface CommercialStore {
  get<K extends CommercialCollection>(
    collection: K,
    id: string,
  ): Promise<CommercialCollectionTypes[K] | undefined>;
  list<K extends CommercialCollection>(collection: K): Promise<readonly CommercialCollectionTypes[K][]>;
  put<K extends CommercialCollection>(
    collection: K,
    id: string,
    value: CommercialCollectionTypes[K],
  ): Promise<void>;
  delete(collection: CommercialCollection, id: string): Promise<void>;
  /** Optional transaction-scoped lock for cross-record invariants. */
  lock?(key: string): Promise<void>;
  transaction<T>(operation: (store: CommercialStore) => Promise<T>): Promise<T>;
}
