import {
  entitlementSchema,
  planSchema,
  planValueSchema,
  subscriptionSchema,
  type ActorRef,
  type Entitlement,
  type EntitlementStatus,
  type OrganizationId,
  type Plan,
  type PlanId,
  type Subscription,
} from '@spiderbyte/commercial-domain';
import type {
  AuditWriter,
  Clock,
  CommercialStore,
  IdGenerator,
} from '@spiderbyte/commercial-ports';

import { CommercialBillingCodes, CommercialBillingError } from './errors';

export interface EntitlementDecision {
  readonly organization_id: OrganizationId;
  readonly key: string;
  readonly status: EntitlementStatus;
  readonly value: boolean | number | string | undefined;
  readonly source: 'plan' | 'contract' | 'override' | 'adapter' | undefined;
  readonly plan_id: PlanId | undefined;
  readonly subscription_id: string | undefined;
  readonly evaluated_at: string;
  readonly reason: string;
}

export interface PlanSeed {
  readonly code: string;
  readonly name: string;
  readonly edition: 'free' | 'team' | 'business' | 'enterprise';
  readonly entitlements: Readonly<Record<string, boolean | number | string>>;
}

/**
 * Plan data is supplied as records, not hard-coded checks in request handlers.
 * These seeds are a local catalog fixture; hosted deployments should load the
 * same shape from their control-plane database and contract configuration.
 */
export const DEFAULT_PLAN_SEEDS: readonly PlanSeed[] = [
  {
    code: 'free',
    name: 'Open Core / Local',
    edition: 'free',
    entitlements: {
      local_execution: true,
      customer_managed_execution: true,
      hosted_runs: 0,
      concurrent_runs: 0,
      hosted_compute: false,
      managed_llm: false,
      hosted_artifacts: false,
      api_access: true,
      service_accounts: false,
      sso: false,
    },
  },
  {
    code: 'team',
    name: 'Team',
    edition: 'team',
    entitlements: {
      seats: 10,
      hosted_runs: 500,
      concurrent_runs: 5,
      organization_workspace: true,
      invitations: true,
      standard_roles: true,
      shared_projects: true,
      hosted_api: true,
      hosted_cli: true,
      managed_llm: 'adapter_required',
      hosted_compute: 'adapter_required',
      hosted_artifacts: 'adapter_required',
      usage_visibility: 'basic',
      budgets: 'basic',
      seat_price_minor: 8_000,
      seat_price_currency: 'USD',
      billing_interval: 'month',
      storage_bytes: 100_000_000_000,
      api_access: true,
      service_accounts: true,
      sso: false,
    },
  },
  {
    code: 'business',
    name: 'Business',
    edition: 'business',
    entitlements: {
      seats: 100,
      hosted_runs: 5_000,
      concurrent_runs: 25,
      storage_bytes: 1_000_000_000_000,
      api_access: true,
      service_accounts: true,
      advanced_rbac: true,
      managed_llm: 'adapter_required',
      hosted_compute: 'adapter_required',
      hosted_artifacts: 'adapter_required',
      project_workspace_restrictions: true,
      policy_inheritance: true,
      approval_routing: true,
      provider_model_restrictions: true,
      organization_project_user_budgets: true,
      centralized_usage_administration: true,
      audit_export: true,
      retention_controls: true,
      customer_managed_workers: true,
      slack_integration: true,
      teams_integration: true,
      seat_price_minor: 12_000,
      seat_price_currency: 'USD',
      billing_interval: 'month',
      audit_retention_days: 365,
      sso: false,
    },
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    edition: 'enterprise',
    entitlements: {
      seats: 'contract',
      hosted_runs: 'contract',
      concurrent_runs: 'contract',
      storage_bytes: 'contract',
      api_access: true,
      service_accounts: true,
      advanced_rbac: true,
      managed_llm: 'adapter_required',
      hosted_compute: 'adapter_required',
      hosted_artifacts: 'adapter_required',
      enterprise_sso: 'adapter_required',
      scim: 'adapter_required',
      verified_domains: 'adapter_required',
      private_networking: 'adapter_required',
      dedicated_execution: 'adapter_required',
      customer_managed_secrets: 'adapter_required',
      data_residency: 'contract',
      dedicated_deployment: 'contract',
      compliance_controls: 'contract',
      sso: 'adapter_required',
      deployment_mode: 'contract',
      enterprise_configuration: true,
      support_access: true,
    },
  },
];

export interface EntitlementServiceDependencies {
  readonly store: CommercialStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly audit: AuditWriter;
}

export interface InstallPlanInput extends PlanSeed {
  readonly account_id: string;
  readonly actor: ActorRef;
}

export interface SetEntitlementInput {
  readonly account_id: string;
  readonly organization_id: OrganizationId;
  readonly key: string;
  readonly status: EntitlementStatus;
  readonly value?: boolean | number | string;
  readonly source: 'contract' | 'override' | 'adapter';
  readonly effective_at?: string;
  readonly expires_at?: string;
  readonly actor: ActorRef;
  readonly request_id: string;
}

export class CommercialEntitlementService {
  constructor(private readonly deps: EntitlementServiceDependencies) {}

  async installPlan(input: InstallPlanInput): Promise<Plan> {
    const now = this.deps.clock.now();
    const plan = planSchema.parse({
      id: this.deps.ids.next('plan_'),
      code: input.code,
      name: input.name,
      edition: input.edition,
      state: 'active',
      entitlements: input.entitlements,
      version: 1,
      created_at: now,
      updated_at: now,
      created_by: input.actor,
      updated_by: input.actor,
    });
    await this.deps.store.put('plans', plan.id, plan);
    await this.deps.audit.append({
      account_id: input.account_id,
      actor: input.actor,
      action: 'plan.install',
      target_type: 'plan',
      target_id: plan.id,
      outcome: 'succeeded',
      request_id: `plan-install-${plan.id}`,
      occurred_at: now,
      detail: { code: plan.code, edition: plan.edition },
    });
    return plan;
  }

  async seedDefaultPlans(accountId: string, actor: ActorRef): Promise<readonly Plan[]> {
    const existing = await this.deps.store.list('plans');
    const plans: Plan[] = [];
    for (const seed of DEFAULT_PLAN_SEEDS) {
      const found = existing.find((candidate) => candidate.code === seed.code && candidate.state === 'active');
      plans.push(found ?? await this.installPlan({ ...seed, account_id: accountId, actor }));
    }
    return plans;
  }

  async changeSubscription(input: {
    readonly account_id: string;
    readonly organization_id: OrganizationId;
    readonly plan_id: PlanId;
    readonly current_period_start?: string;
    readonly current_period_end?: string;
    readonly actor: ActorRef;
    readonly request_id: string;
  }): Promise<Subscription> {
    const plan = await this.deps.store.get('plans', input.plan_id);
    if (plan === undefined) throw new CommercialBillingError(CommercialBillingCodes.PLAN_NOT_FOUND, 'plan not found');
    if (plan.state !== 'active') throw new CommercialBillingError(CommercialBillingCodes.PLAN_NOT_ACTIVE, 'plan is not active');
    const now = this.deps.clock.now();
    const start = input.current_period_start ?? now;
    const end = input.current_period_end ?? addUtcMonth(start);
    if (Date.parse(end) <= Date.parse(start)) {
      throw new CommercialBillingError(CommercialBillingCodes.BILLING_PERIOD_INVALID, 'subscription period must end after it starts');
    }
    const fingerprint = [input.account_id, input.organization_id, input.plan_id, start, end].join(':');
    const idempotencyKey = `subscription.change:${input.request_id}`;
    const replay = await this.deps.store.get('idempotency', idempotencyKey);
    if (replay !== undefined) {
      if (replay.fingerprint !== fingerprint) {
        throw new CommercialBillingError(CommercialBillingCodes.IDEMPOTENCY_REUSED, 'subscription change request id was already used for different input');
      }
      return JSON.parse(replay.result_json) as Subscription;
    }
    return this.deps.store.transaction(async (store) => {
      const current = await this.currentSubscription(input.organization_id);
      if (current !== undefined && ['active', 'trialing', 'grace'].includes(current.state)) {
        await store.put('subscriptions', current.id, {
          ...current,
          state: 'canceled',
          canceled_at: now,
          version: current.version + 1,
          updated_at: now,
          updated_by: input.actor,
        });
      }
      const subscription = subscriptionSchema.parse({
        id: this.deps.ids.next('sub_'),
        account_id: input.account_id,
        organization_id: input.organization_id,
        plan_id: input.plan_id,
        state: 'active',
        current_period_start: start,
        current_period_end: end,
        version: 1,
        created_at: now,
        updated_at: now,
        created_by: input.actor,
        updated_by: input.actor,
      });
      await store.put('subscriptions', subscription.id, subscription);
      await store.put('idempotency', idempotencyKey, {
        scope: 'subscription.change',
        request_id: input.request_id,
        fingerprint,
        result_json: JSON.stringify(subscription),
        created_at: now,
      });
      await this.deps.audit.append({
        account_id: input.account_id,
        organization_id: input.organization_id,
        actor: input.actor,
        action: 'subscription.change',
        target_type: 'subscription',
        target_id: subscription.id,
        outcome: 'succeeded',
        request_id: input.request_id,
        occurred_at: now,
        detail: { plan_id: plan.id, plan_code: plan.code },
      });
      return subscription;
    });
  }

  async setEntitlement(input: SetEntitlementInput): Promise<Entitlement> {
    if (input.value !== undefined) planValueSchema.parse(input.value);
    const now = this.deps.clock.now();
    const entitlement = entitlementSchema.parse({
      id: this.deps.ids.next('ent_'),
      account_id: input.account_id,
      organization_id: input.organization_id,
      key: input.key,
      status: input.status,
      value: input.value,
      source: input.source,
      effective_at: input.effective_at ?? now,
      expires_at: input.expires_at,
      version: 1,
      created_at: now,
      updated_at: now,
      created_by: input.actor,
      updated_by: input.actor,
    });
    await this.deps.store.put('entitlements', entitlement.id, entitlement);
    await this.deps.audit.append({
      account_id: input.account_id,
      organization_id: input.organization_id,
      actor: input.actor,
      action: 'entitlement.set',
      target_type: 'entitlement',
      target_id: entitlement.id,
      outcome: 'succeeded',
      request_id: input.request_id,
      occurred_at: now,
      detail: { key: input.key, source: input.source, status: input.status },
    });
    return entitlement;
  }

  async evaluate(organizationId: OrganizationId, key: string, at = this.deps.clock.now()): Promise<EntitlementDecision> {
    const subscription = await this.currentSubscription(organizationId);
    if (subscription === undefined) {
      return {
        organization_id: organizationId,
        key,
        status: 'not_configured',
        value: undefined,
        source: undefined,
        plan_id: undefined,
        subscription_id: undefined,
        evaluated_at: at,
        reason: 'no active subscription is configured for the organization',
      };
    }
    const plan = await this.deps.store.get('plans', subscription.plan_id);
    if (plan === undefined || plan.state !== 'active') {
      return {
        organization_id: organizationId,
        key,
        status: 'not_configured',
        value: undefined,
        source: undefined,
        plan_id: subscription.plan_id,
        subscription_id: subscription.id,
        evaluated_at: at,
        reason: 'the subscription references no active plan',
      };
    }
    const explicit = (await this.deps.store.list('entitlements'))
      .filter((candidate) => candidate.organization_id === organizationId && candidate.key === key)
      .filter((candidate) => Date.parse(candidate.effective_at) <= Date.parse(at))
      .filter((candidate) => candidate.expires_at === undefined || Date.parse(candidate.expires_at) > Date.parse(at))
      .toSorted((left, right) => sourceRank(right.source) - sourceRank(left.source) || right.version - left.version)[0];
    if (explicit !== undefined) {
      return decisionFromEntitlement(explicit, subscription, at);
    }
    if (['restricted', 'expired', 'canceled'].includes(subscription.state)) {
      return {
        organization_id: organizationId,
        key,
        status: 'temporarily_unavailable',
        value: undefined,
        source: 'plan',
        plan_id: plan.id,
        subscription_id: subscription.id,
        evaluated_at: at,
        reason: `subscription is ${subscription.state}`,
      };
    }
    const value = plan.entitlements[key];
    if (value === undefined || value === false) {
      return {
        organization_id: organizationId,
        key,
        status: 'not_included',
        value,
        source: 'plan',
        plan_id: plan.id,
        subscription_id: subscription.id,
        evaluated_at: at,
        reason: 'capability is not included in the active plan',
      };
    }
    if (value === 'adapter_required') {
      return {
        organization_id: organizationId,
        key,
        status: 'not_configured',
        value,
        source: 'plan',
        plan_id: plan.id,
        subscription_id: subscription.id,
        evaluated_at: at,
        reason: 'plan includes the capability only when its external adapter is configured',
      };
    }
    return {
      organization_id: organizationId,
      key,
      status: 'included',
      value,
      source: 'plan',
      plan_id: plan.id,
      subscription_id: subscription.id,
      evaluated_at: at,
      reason: 'capability is included in the active plan',
    };
  }

  async assertIncluded(organizationId: OrganizationId, key: string, at?: string): Promise<EntitlementDecision> {
    const decision = await this.evaluate(organizationId, key, at);
    if (decision.status === 'included' || decision.status === 'configured') return decision;
    const code = decision.status === 'not_included'
      ? CommercialBillingCodes.ENTITLEMENT_NOT_INCLUDED
      : decision.status === 'not_configured'
        ? CommercialBillingCodes.ENTITLEMENT_NOT_CONFIGURED
        : CommercialBillingCodes.ENTITLEMENT_UNAVAILABLE;
    throw new CommercialBillingError(code, decision.reason, {
      organization_id: organizationId,
      entitlement: key,
      status: decision.status,
    });
  }

  async expireSubscriptions(at = this.deps.clock.now()): Promise<readonly Subscription[]> {
    const changed: Subscription[] = [];
    for (const subscription of await this.deps.store.list('subscriptions')) {
      if (!['active', 'trialing', 'grace'].includes(subscription.state)) continue;
      if (Date.parse(subscription.current_period_end) > Date.parse(at)) continue;
      const nextState = subscription.grace_until !== undefined && Date.parse(subscription.grace_until) > Date.parse(at)
        ? 'grace'
        : 'restricted';
      const updated = subscriptionSchema.parse({
        ...subscription,
        state: nextState,
        version: subscription.version + 1,
        updated_at: at,
        updated_by: { kind: 'system', id: 'billing-expiry' },
      });
      await this.deps.store.put('subscriptions', updated.id, updated);
      changed.push(updated);
    }
    return changed;
  }

  private async currentSubscription(organizationId: OrganizationId): Promise<Subscription | undefined> {
    return (await this.deps.store.list('subscriptions'))
      .filter((candidate) => candidate.organization_id === organizationId)
      .toSorted((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at) || right.id.localeCompare(left.id))[0];
  }
}

function sourceRank(source: Entitlement['source']): number {
  return source === 'contract' ? 4 : source === 'override' ? 3 : source === 'adapter' ? 2 : 1;
}

function decisionFromEntitlement(
  entitlement: Entitlement,
  subscription: Subscription,
  at: string,
): EntitlementDecision {
  return {
    organization_id: entitlement.organization_id,
    key: entitlement.key,
    status: entitlement.status,
    value: entitlement.value,
    source: entitlement.source,
    plan_id: subscription.plan_id,
    subscription_id: subscription.id,
    evaluated_at: at,
    reason: `entitlement is ${entitlement.status} from ${entitlement.source}`,
  };
}

function addUtcMonth(value: string): string {
  const date = new Date(value);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString();
}
