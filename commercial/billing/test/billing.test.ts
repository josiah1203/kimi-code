import { describe, expect, it } from 'vitest';

import {
  InMemoryAuditWriter,
  InMemoryCommercialStore,
  LocalTestPaymentAdapter,
  MonotonicIdGenerator,
  UnavailablePaymentAdapter,
} from '../../adapters/src/index';
import {
  CommercialBillingCodes,
  CommercialBillingError,
  CommercialBillingService,
  CommercialEntitlementService,
  UsageLedgerService,
} from '@spiderbyte/commercial-billing';
import type { PaymentAdapter } from '@spiderbyte/commercial-ports';

const now = '2026-08-11T12:00:00.000Z';
const actor = { kind: 'system' as const, id: 'billing-test' };

function createServices(payment: PaymentAdapter = new LocalTestPaymentAdapter({ now: () => now }, new MonotonicIdGenerator())) {
  const store = new InMemoryCommercialStore();
  const audit = new InMemoryAuditWriter();
  const clock = { now: () => now };
  const ids = new MonotonicIdGenerator();
  return {
    store,
    audit,
    entitlements: new CommercialEntitlementService({ store, clock, ids, audit }),
    ledger: new UsageLedgerService({ store, clock, ids, audit }),
    billing: new CommercialBillingService({ store, payment, clock, ids, audit }),
  };
}

describe('commercial plans, usage, and billing', () => {
  it('evaluates data-driven plan entitlements and distinguishes unavailable states', async () => {
    const { entitlements } = createServices();
    const plans = await entitlements.seedDefaultPlans('acct_01', actor);
    const free = plans.find((plan) => plan.code === 'free')!;
    const subscription = await entitlements.changeSubscription({
      account_id: 'acct_01',
      organization_id: 'org_01',
      plan_id: free.id,
      actor,
      request_id: 'subscription-1',
    });
    expect((await entitlements.changeSubscription({
      account_id: 'acct_01',
      organization_id: 'org_01',
      plan_id: free.id,
      actor,
      request_id: 'subscription-1',
    })).id).toBe(subscription.id);
    await expect(entitlements.assertIncluded('org_01', 'api_access')).resolves.toMatchObject({ status: 'included' });
    await expect(entitlements.assertIncluded('org_01', 'sso')).rejects.toMatchObject({
      code: CommercialBillingCodes.ENTITLEMENT_NOT_INCLUDED,
    });
    await entitlements.setEntitlement({
      account_id: 'acct_01',
      organization_id: 'org_01',
      key: 'sso',
      status: 'not_configured',
      source: 'adapter',
      actor,
      request_id: 'entitlement-1',
    });
    await expect(entitlements.assertIncluded('org_01', 'sso')).rejects.toMatchObject({
      code: CommercialBillingCodes.ENTITLEMENT_NOT_CONFIGURED,
    });
  });

  it('handles plan upgrades, downgrades, and expiry without stale-subscription selection', async () => {
    const { entitlements } = createServices();
    const plans = await entitlements.seedDefaultPlans('acct_01', actor);
    const free = plans.find((plan) => plan.code === 'free')!;
    const team = plans.find((plan) => plan.code === 'team')!;
    await entitlements.changeSubscription({ account_id: 'acct_01', organization_id: 'org_01', plan_id: free.id, actor, request_id: 'plan-free' });
    await entitlements.changeSubscription({ account_id: 'acct_01', organization_id: 'org_01', plan_id: team.id, actor, request_id: 'plan-team' });
    await expect(entitlements.assertIncluded('org_01', 'seats')).resolves.toMatchObject({ value: 10 });
    await entitlements.changeSubscription({ account_id: 'acct_01', organization_id: 'org_01', plan_id: free.id, actor, request_id: 'plan-free-downgrade' });
    await expect(entitlements.assertIncluded('org_01', 'seats')).rejects.toMatchObject({ code: CommercialBillingCodes.ENTITLEMENT_NOT_INCLUDED });

    const expired = await entitlements.expireSubscriptions('2026-09-12T00:00:00.000Z');
    expect(expired).toHaveLength(1);
    expect(expired[0]?.state).toBe('restricted');
    await expect(entitlements.assertIncluded('org_01', 'api_access')).rejects.toMatchObject({ code: CommercialBillingCodes.ENTITLEMENT_UNAVAILABLE });
  });

  it('records idempotent usage, enforces a hard budget, and reconciles through append-only entries', async () => {
    const { ledger, store } = createServices();
    await ledger.createBudget({
      account_id: 'acct_01',
      organization_id: 'org_01',
      workspace_id: 'cws_01',
      scope: 'workspace',
      scope_id: 'cws_01',
      meter: 'hosted_cpu',
      unit: 'seconds',
      currency: 'USD',
      limit_minor: 100,
      period_start: '2026-08-01T00:00:00.000Z',
      period_end: '2026-09-01T00:00:00.000Z',
      actor,
      request_id: 'budget-1',
    });
    const input = {
      account_id: 'acct_01',
      organization_id: 'org_01',
      workspace_id: 'cws_01',
      resource_type: 'hosted_cpu',
      reserved_amount: 5,
      actual_amount: 0,
      unit: 'seconds' as const,
      price_basis: {
        unit_price_minor: 10,
        multiplier: 1,
        currency: 'USD',
        price_book_id: 'price-test',
      },
      idempotency_key: 'usage-key-1',
      source_event_id: 'worker-event-1',
      source: 'worker' as const,
      actor,
      request_id: 'usage-1',
    };
    const reserved = await ledger.recordUsage(input);
    expect((await ledger.recordUsage(input)).id).toBe(reserved.id);
    expect((await store.list('budgets'))[0]?.reserved_minor).toBe(50);

    const reconciled = await ledger.reconcileUsage({
      usage_event_id: reserved.id,
      actual_amount: 3,
      actor,
      request_id: 'reconcile-1',
    });
    expect(reconciled.state).toBe('reconciled');
    expect((await store.list('budgets'))[0]).toMatchObject({ reserved_minor: 0, consumed_minor: 30 });
    expect((await ledger.listLedger('org_01')).map((entry) => entry.kind)).toEqual([
      'reservation',
      'release',
      'adjustment',
    ]);

    await expect(ledger.recordUsage({
      ...input,
      idempotency_key: 'usage-key-2',
      source_event_id: 'worker-event-2',
      reserved_amount: 8,
      request_id: 'usage-2',
    })).rejects.toMatchObject({ code: CommercialBillingCodes.BUDGET_EXHAUSTED });
  });

  it('calculates invoices from ledger entries and fails closed without payment infrastructure', async () => {
    const services = createServices();
    await services.ledger.recordUsage({
      account_id: 'acct_01',
      organization_id: 'org_01',
      resource_type: 'api',
      reserved_amount: 0,
      actual_amount: 2,
      unit: 'requests',
      price_basis: { unit_price_minor: 25, multiplier: 1, currency: 'USD', price_book_id: 'price-test' },
      idempotency_key: 'invoice-usage-1',
      source_event_id: 'api-event-1',
      source: 'api',
      actor,
      request_id: 'invoice-usage-request',
    });
    const invoice = await services.billing.createInvoice({
      account_id: 'acct_01',
      organization_id: 'org_01',
      period_start: '2026-08-01T00:00:00.000Z',
      period_end: '2026-09-01T00:00:00.000Z',
      currency: 'USD',
      actor,
      request_id: 'invoice-1',
    });
    expect(invoice.total_minor).toBe(50);
    expect(invoice.state).toBe('open');
    expect((await services.billing.createInvoice({
      account_id: 'acct_01', organization_id: 'org_01', period_start: '2026-08-01T00:00:00.000Z',
      period_end: '2026-09-01T00:00:00.000Z', currency: 'USD', actor, request_id: 'invoice-1',
    })).id).toBe(invoice.id);
    await expect(services.billing.createInvoice({
      account_id: 'acct_01', organization_id: 'org_01', period_start: '2026-08-01T00:00:00.000Z',
      period_end: '2026-09-01T00:00:00.000Z', currency: 'EUR', actor, request_id: 'invoice-1',
    })).rejects.toMatchObject({ code: CommercialBillingCodes.IDEMPOTENCY_REUSED });

    const unavailable = createServices(new UnavailablePaymentAdapter());
    await expect(unavailable.billing.createInvoice({
      account_id: 'acct_01',
      organization_id: 'org_01',
      period_start: '2026-08-01T00:00:00.000Z',
      period_end: '2026-09-01T00:00:00.000Z',
      currency: 'USD',
      actor,
      request_id: 'invoice-unavailable',
    })).rejects.toMatchObject({ code: 'commercial.payment.not_configured' });
  });

  it('rejects duplicate source events and different payloads under one idempotency key', async () => {
    const { ledger } = createServices();
    const base = {
      account_id: 'acct_01',
      organization_id: 'org_01',
      resource_type: 'api',
      reserved_amount: 0,
      actual_amount: 1,
      unit: 'requests' as const,
      idempotency_key: 'duplicate-key-1',
      source_event_id: 'duplicate-source-1',
      source: 'api' as const,
      actor,
      request_id: 'duplicate-1',
    };
    await ledger.recordUsage(base);
    await expect(ledger.recordUsage({ ...base, idempotency_key: 'duplicate-key-2', request_id: 'duplicate-2' })).rejects.toMatchObject({
      code: CommercialBillingCodes.DUPLICATE_SOURCE_EVENT,
    });
    await expect(ledger.recordUsage({ ...base, actual_amount: 2 })).rejects.toMatchObject({
      code: CommercialBillingCodes.USAGE_IDEMPOTENCY_REUSED,
    });
    expect(CommercialBillingError).toBeDefined();
  });
});
