import { createHash } from 'node:crypto';

import {
  budgetSchema,
  ledgerEntrySchema,
  usageEventSchema,
  type ActorRef,
  type Budget,
  type CreateUsageEventInput,
  type LedgerEntry,
  type UsageEvent,
} from '@spiderbyte/commercial-domain';
import type {
  AuditWriter,
  Clock,
  CommercialStore,
  IdGenerator,
} from '@spiderbyte/commercial-ports';

import { CommercialBillingCodes, CommercialBillingError } from './errors';

export interface UsageLedgerDependencies {
  readonly store: CommercialStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly audit: AuditWriter;
}

export interface RecordUsageInput extends CreateUsageEventInput {
  readonly account_id: string;
  readonly organization_id: string;
  readonly workspace_id?: string;
  readonly user_id?: string;
  readonly service_account_id?: string;
  readonly run_id?: string;
  readonly attempt_id?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly compute_provider?: string;
  readonly price_basis?: UsageEvent['price_basis'];
  readonly occurred_at?: string;
  readonly actor: ActorRef;
  readonly request_id: string;
}

export interface CreateBudgetInput {
  readonly account_id: string;
  readonly organization_id: string;
  readonly workspace_id?: string;
  readonly scope: Budget['scope'];
  readonly scope_id: string;
  readonly meter: string;
  readonly unit: string;
  readonly currency: string;
  readonly limit_minor: number;
  readonly soft_limit_percent?: number;
  readonly period_start: string;
  readonly period_end: string;
  readonly actor: ActorRef;
  readonly request_id: string;
}

export interface ReconcileUsageInput {
  readonly usage_event_id: string;
  readonly actual_amount: number;
  readonly actor: ActorRef;
  readonly request_id: string;
}

export class UsageLedgerService {
  constructor(private readonly deps: UsageLedgerDependencies) {}

  async createBudget(input: CreateBudgetInput): Promise<Budget> {
    if (input.limit_minor < 0 || !Number.isInteger(input.limit_minor)) {
      throw new CommercialBillingError(CommercialBillingCodes.BUDGET_EXHAUSTED, 'budget limit must be a non-negative integer');
    }
    const now = this.deps.clock.now();
    const budget = budgetSchema.parse({
      id: this.deps.ids.next('budget_'),
      account_id: input.account_id,
      organization_id: input.organization_id,
      workspace_id: input.workspace_id,
      scope: input.scope,
      scope_id: input.scope_id,
      meter: input.meter,
      unit: input.unit,
      currency: input.currency,
      limit_minor: input.limit_minor,
      reserved_minor: 0,
      consumed_minor: 0,
      soft_limit_percent: input.soft_limit_percent ?? 80,
      state: 'active',
      period_start: input.period_start,
      period_end: input.period_end,
      version: 1,
      created_at: now,
      updated_at: now,
      created_by: input.actor,
      updated_by: input.actor,
    });
    await this.deps.store.put('budgets', budget.id, budget);
    await this.deps.audit.append({
      account_id: input.account_id,
      organization_id: input.organization_id,
      workspace_id: input.workspace_id,
      actor: input.actor,
      action: 'budget.create',
      target_type: 'budget',
      target_id: budget.id,
      outcome: 'succeeded',
      request_id: input.request_id,
      occurred_at: now,
    });
    return budget;
  }

  async recordUsage(input: RecordUsageInput): Promise<UsageEvent> {
    const existing = (await this.deps.store.list('usage_events')).find((candidate) =>
      candidate.account_id === input.account_id && candidate.organization_id === input.organization_id &&
      candidate.idempotency_key === input.idempotency_key,
    );
    const fingerprint = hashJson(inputFingerprint(input));
    if (existing !== undefined) {
      if (existing.metadata?.['idempotency_fingerprint'] !== fingerprint) {
        throw new CommercialBillingError(CommercialBillingCodes.USAGE_IDEMPOTENCY_REUSED, 'usage idempotency key was reused with different input');
      }
      return existing;
    }
    const sourceDuplicate = (await this.deps.store.list('usage_events')).find((candidate) =>
      candidate.organization_id === input.organization_id && candidate.source_event_id === input.source_event_id,
    );
    if (sourceDuplicate !== undefined) {
      throw new CommercialBillingError(CommercialBillingCodes.DUPLICATE_SOURCE_EVENT, 'source event was already ingested', {
        usage_event_id: sourceDuplicate.id,
      });
    }
    const occurredAt = input.occurred_at ?? this.deps.clock.now();
    const now = this.deps.clock.now();
    const reservedMinor = priceMinor(input.reserved_amount, input.price_basis);
    const actualMinor = priceMinor(input.actual_amount, input.price_basis);
    const event = usageEventSchema.parse({
      id: this.deps.ids.next('usageevt_'),
      account_id: input.account_id,
      organization_id: input.organization_id,
      workspace_id: input.workspace_id,
      user_id: input.user_id,
      service_account_id: input.service_account_id,
      run_id: input.run_id,
      attempt_id: input.attempt_id,
      provider: input.provider,
      model: input.model,
      compute_provider: input.compute_provider,
      resource_type: input.resource_type,
      reserved_amount: input.reserved_amount,
      actual_amount: input.actual_amount,
      unit: input.unit,
      price_basis: input.price_basis,
      currency: input.price_basis?.currency,
      occurred_at: occurredAt,
      idempotency_key: input.idempotency_key,
      source_event_id: input.source_event_id,
      source: input.source,
      adjustment_status: 'none',
      state: input.reserved_amount > 0 ? 'reserved' : input.actual_amount > 0 ? 'consumed' : 'received',
      version: 1,
      created_at: now,
      updated_at: now,
      created_by: input.actor,
      updated_by: input.actor,
      metadata: { idempotency_fingerprint: fingerprint },
    });
    await this.deps.store.transaction(async (store) => {
      const budget = await this.findBudget(input.organization_id, input.workspace_id, input.resource_type, occurredAt);
      if (budget !== undefined && (input.reserved_amount > 0 || input.actual_amount > 0) && input.price_basis === undefined) {
        throw new CommercialBillingError(CommercialBillingCodes.UNPRICED_BUDGET_USAGE, 'budgeted usage requires a price basis before execution');
      }
      if (reservedMinor > 0 && budget !== undefined) {
        this.assertBudget(budget, reservedMinor);
        await store.put('budgets', budget.id, updateBudget(budget, {
          reserved_minor: budget.reserved_minor + reservedMinor,
          actor: input.actor,
          now,
        }));
      } else if (actualMinor > 0 && budget !== undefined) {
        this.assertBudget(budget, actualMinor);
        await store.put('budgets', budget.id, updateBudget(budget, {
          consumed_minor: budget.consumed_minor + actualMinor,
          actor: input.actor,
          now,
        }));
      }
      await store.put('usage_events', event.id, event);
      if (reservedMinor > 0) {
        await store.put('ledger_entries', `${event.id}:reservation`, this.ledgerEntry({
          event,
          id: this.deps.ids.next('ledger_'),
          kind: 'reservation',
          direction: 'debit',
          quantity: input.reserved_amount,
          amount_minor: reservedMinor,
          actor: input.actor,
          now,
        }));
      } else if (actualMinor > 0) {
        await store.put('ledger_entries', `${event.id}:charge`, this.ledgerEntry({
          event,
          id: this.deps.ids.next('ledger_'),
          kind: 'charge',
          direction: 'debit',
          quantity: input.actual_amount,
          amount_minor: actualMinor,
          actor: input.actor,
          now,
        }));
      }
    });
    await this.deps.audit.append({
      account_id: input.account_id,
      organization_id: input.organization_id,
      workspace_id: input.workspace_id,
      actor: input.actor,
      action: 'usage.record',
      target_type: 'usage_event',
      target_id: event.id,
      outcome: 'succeeded',
      request_id: input.request_id,
      occurred_at: now,
      detail: { resource_type: input.resource_type, unit: input.unit, source: input.source },
    });
    return event;
  }

  async reconcileUsage(input: ReconcileUsageInput): Promise<UsageEvent> {
    if (!Number.isFinite(input.actual_amount) || input.actual_amount < 0) {
      throw new CommercialBillingError(CommercialBillingCodes.INVALID_USAGE_RECONCILIATION, 'actual usage must be finite and non-negative');
    }
    const idempotencyKey = `usage-reconcile:${input.request_id}`;
    const storedReplay = await this.deps.store.get('idempotency', idempotencyKey);
    if (storedReplay !== undefined) return JSON.parse(storedReplay.result_json) as UsageEvent;
    const event = await this.deps.store.get('usage_events', input.usage_event_id);
    if (event === undefined) throw new CommercialBillingError(CommercialBillingCodes.USAGE_NOT_FOUND, 'usage event not found');
    if (event.state === 'reconciled' && event.actual_amount === input.actual_amount) return event;
    const now = this.deps.clock.now();
    const previousMinor = priceMinor(event.actual_amount, event.price_basis);
    const actualMinor = priceMinor(input.actual_amount, event.price_basis);
    const reservationMinor = priceMinor(event.reserved_amount, event.price_basis);
    const updated = usageEventSchema.parse({
      ...event,
      actual_amount: input.actual_amount,
      state: 'reconciled',
      adjustment_status: previousMinor === actualMinor ? 'none' : 'applied',
      version: event.version + 1,
      updated_at: now,
      updated_by: input.actor,
    });
    await this.deps.store.transaction(async (store) => {
      const budget = await this.findBudget(event.organization_id, event.workspace_id, event.resource_type, event.occurred_at);
      if (budget !== undefined) {
        const nextReserved = Math.max(0, budget.reserved_minor - reservationMinor);
        const nextConsumed = budget.consumed_minor + actualMinor;
        if (budget.limit_minor < nextReserved + nextConsumed) {
          throw new CommercialBillingError(CommercialBillingCodes.BUDGET_EXHAUSTED, 'reconciled usage exceeds the budget hard limit', {
            budget_id: budget.id,
            limit_minor: budget.limit_minor,
            reserved_minor: nextReserved,
            consumed_minor: nextConsumed,
          });
        }
        await store.put('budgets', budget.id, updateBudget(budget, {
          reserved_minor: nextReserved,
          consumed_minor: nextConsumed,
          actor: input.actor,
          now,
        }));
      }
      await store.put('usage_events', updated.id, updated);
      if (reservationMinor > 0) {
        await store.put('ledger_entries', `${event.id}:release:${event.version + 1}`, this.ledgerEntry({
          event: updated,
          id: this.deps.ids.next('ledger_'),
          kind: 'release',
          direction: 'credit',
          quantity: event.reserved_amount,
          amount_minor: reservationMinor,
          actor: input.actor,
          now,
        }));
      }
      const delta = actualMinor - previousMinor;
      if (delta !== 0) {
        await store.put('ledger_entries', `${event.id}:adjustment:${event.version + 1}`, this.ledgerEntry({
          event: updated,
          id: this.deps.ids.next('ledger_'),
          kind: 'adjustment',
          direction: delta > 0 ? 'debit' : 'credit',
          quantity: Math.abs(input.actual_amount - event.actual_amount),
          amount_minor: Math.abs(delta),
          actor: input.actor,
          now,
        }));
      }
      await store.put('idempotency', idempotencyKey, {
        scope: 'usage.reconcile',
        request_id: input.request_id,
        fingerprint: hashJson({ usage_event_id: input.usage_event_id, actual_amount: input.actual_amount }),
        result_json: JSON.stringify(updated),
        created_at: now,
      });
    });
    await this.deps.audit.append({
      account_id: event.account_id,
      organization_id: event.organization_id,
      workspace_id: event.workspace_id,
      actor: input.actor,
      action: 'usage.reconcile',
      target_type: 'usage_event',
      target_id: event.id,
      outcome: 'succeeded',
      request_id: input.request_id,
      occurred_at: now,
      detail: { previous_amount: event.actual_amount, actual_amount: input.actual_amount },
    });
    return updated;
  }

  async listLedger(organizationId: string): Promise<readonly LedgerEntry[]> {
    return (await this.deps.store.list('ledger_entries')).filter((entry) => entry.organization_id === organizationId);
  }

  private async findBudget(
    organizationId: string,
    workspaceId: string | undefined,
    meter: string,
    at: string,
  ): Promise<Budget | undefined> {
    return (await this.deps.store.list('budgets'))
      .filter((budget) => budget.organization_id === organizationId && budget.meter === meter && budget.state === 'active')
      .filter((budget) => budget.workspace_id === undefined || budget.workspace_id === workspaceId)
      .filter((budget) => Date.parse(budget.period_start) <= Date.parse(at) && Date.parse(budget.period_end) > Date.parse(at))
      .toSorted((left, right) => Number(right.workspace_id !== undefined) - Number(left.workspace_id !== undefined))[0];
  }

  private assertBudget(budget: Budget, additionalMinor: number): void {
    if (budget.limit_minor < budget.reserved_minor + budget.consumed_minor + additionalMinor) {
      throw new CommercialBillingError(CommercialBillingCodes.BUDGET_EXHAUSTED, 'budget hard limit would be exceeded', {
        budget_id: budget.id,
        limit_minor: budget.limit_minor,
        reserved_minor: budget.reserved_minor,
        consumed_minor: budget.consumed_minor,
        requested_minor: additionalMinor,
      });
    }
  }

  private ledgerEntry(input: {
    readonly event: UsageEvent;
    readonly id: string;
    readonly kind: LedgerEntry['kind'];
    readonly direction: LedgerEntry['direction'];
    readonly quantity: number;
    readonly amount_minor: number;
    readonly actor: ActorRef;
    readonly now: string;
  }): LedgerEntry {
    return ledgerEntrySchema.parse({
      id: input.id,
      account_id: input.event.account_id,
      organization_id: input.event.organization_id,
      workspace_id: input.event.workspace_id,
      usage_event_id: input.event.id,
      kind: input.kind,
      direction: input.direction,
      quantity: input.quantity,
      unit: input.event.unit,
      amount_minor: input.amount_minor,
      currency: input.event.currency ?? input.event.price_basis?.currency ?? 'USD',
      state: 'posted',
      occurred_at: input.now,
      posted_at: input.now,
      version: 1,
      created_at: input.now,
      updated_at: input.now,
      created_by: input.actor,
      updated_by: input.actor,
    });
  }
}

function updateBudget(
  budget: Budget,
  input: { readonly reserved_minor?: number; readonly consumed_minor?: number; readonly actor: ActorRef; readonly now: string },
): Budget {
  return budgetSchema.parse({
    ...budget,
    reserved_minor: input.reserved_minor ?? budget.reserved_minor,
    consumed_minor: input.consumed_minor ?? budget.consumed_minor,
    state: (input.consumed_minor ?? budget.consumed_minor) >= budget.limit_minor ? 'exhausted' : budget.state,
    version: budget.version + 1,
    updated_at: input.now,
    updated_by: input.actor,
  });
}

function priceMinor(amount: number, priceBasis: UsageEvent['price_basis']): number {
  if (amount === 0 || priceBasis === undefined) return 0;
  return Math.ceil(amount * priceBasis.unit_price_minor * priceBasis.multiplier);
}

function inputFingerprint(input: RecordUsageInput): unknown {
  const { actor: _actor, request_id: _requestId, ...stable } = input;
  return stable;
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
