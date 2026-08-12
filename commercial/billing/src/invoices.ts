import {
  billingPeriodSchema,
  invoiceSchema,
  paymentStatusSchema,
  type ActorRef,
  type Invoice,
  type PaymentStatus,
} from '@spiderbyte/commercial-domain';
import {
  CapabilityUnavailableError,
  type AuditWriter,
  type Clock,
  type CommercialStore,
  type IdGenerator,
  type PaymentAdapter,
} from '@spiderbyte/commercial-ports';

import { CommercialBillingCodes, CommercialBillingError } from './errors';

export interface BillingServiceDependencies {
  readonly store: CommercialStore;
  readonly payment: PaymentAdapter;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly audit: AuditWriter;
}

export interface CreateInvoiceInput {
  readonly account_id: string;
  readonly organization_id: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly currency: string;
  readonly tax_minor?: number;
  readonly actor: ActorRef;
  readonly request_id: string;
}

export class CommercialBillingService {
  constructor(private readonly deps: BillingServiceDependencies) {}

  async createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
    const status = this.deps.payment.capability();
    if (status.availability !== 'available') throw new CapabilityUnavailableError(status);
    if (Date.parse(input.period_end) <= Date.parse(input.period_start)) {
      throw new CommercialBillingError(CommercialBillingCodes.BILLING_PERIOD_INVALID, 'billing period must end after it starts');
    }
    const replay = await this.deps.store.get('idempotency', `invoice.create:${input.request_id}`);
    const fingerprint = [input.account_id, input.organization_id, input.period_start, input.period_end, input.currency, input.tax_minor ?? 0].join(':');
    if (replay !== undefined) {
      if (replay.fingerprint !== fingerprint) {
        throw new CommercialBillingError(CommercialBillingCodes.IDEMPOTENCY_REUSED, 'invoice request id was already used for different input');
      }
      return JSON.parse(replay.result_json) as Invoice;
    }
    const now = this.deps.clock.now();
    const period = billingPeriodSchema.parse({
      id: this.deps.ids.next('period_'),
      account_id: input.account_id,
      organization_id: input.organization_id,
      start_at: input.period_start,
      end_at: input.period_end,
      state: 'open',
      version: 1,
      created_at: now,
      updated_at: now,
      created_by: input.actor,
      updated_by: input.actor,
    });
    const entries = (await this.deps.store.list('ledger_entries')).filter((entry) =>
      entry.organization_id === input.organization_id &&
      Date.parse(entry.occurred_at) >= Date.parse(input.period_start) &&
      Date.parse(entry.occurred_at) < Date.parse(input.period_end) &&
      ['posted', 'reconciled'].includes(entry.state),
    );
    const subtotalMinor = entries.reduce((total, entry) =>
      total + (entry.direction === 'debit' ? entry.amount_minor : -entry.amount_minor), 0);
    const taxMinor = input.tax_minor ?? 0;
    if (subtotalMinor < 0 || taxMinor < 0) {
      throw new CommercialBillingError(CommercialBillingCodes.BILLING_PERIOD_INVALID, 'invoice totals cannot be negative');
    }
    const invoiceId = this.deps.ids.next('inv_');
    const invoice = await this.deps.payment.createInvoice({
      account_id: input.account_id,
      organization_id: input.organization_id,
      period_id: period.id,
      invoice_id: invoiceId,
      currency: input.currency,
      subtotal_minor: subtotalMinor,
      tax_minor: taxMinor,
      total_minor: subtotalMinor + taxMinor,
      amount_due_minor: subtotalMinor + taxMinor,
      request_id: input.request_id,
    });
    const validated = invoiceSchema.parse({
      ...invoice,
      id: invoice.id || invoiceId,
      account_id: input.account_id,
      organization_id: input.organization_id,
      billing_period_id: period.id,
      currency: input.currency,
      subtotal_minor: subtotalMinor,
      tax_minor: taxMinor,
      total_minor: subtotalMinor + taxMinor,
      amount_due_minor: subtotalMinor + taxMinor,
      version: invoice.version ?? 1,
      created_at: invoice.created_at ?? now,
      updated_at: invoice.updated_at ?? now,
      created_by: invoice.created_by ?? input.actor,
      updated_by: invoice.updated_by ?? input.actor,
    });
    await this.deps.store.transaction(async (store) => {
      await store.put('billing_periods', period.id, period);
      await store.put('invoices', validated.id, validated);
      await store.put('idempotency', `invoice.create:${input.request_id}`, {
        scope: 'invoice.create',
        request_id: input.request_id,
        fingerprint,
        result_json: JSON.stringify(validated),
        created_at: now,
      });
    });
    await this.deps.audit.append({
      account_id: input.account_id,
      organization_id: input.organization_id,
      actor: input.actor,
      action: 'invoice.create',
      target_type: 'invoice',
      target_id: validated.id,
      outcome: 'succeeded',
      request_id: input.request_id,
      occurred_at: now,
      detail: { total_minor: validated.total_minor, currency: validated.currency },
    });
    return validated;
  }

  async refreshPaymentStatus(organizationId: string, accountId: string, actor: ActorRef, requestId: string): Promise<PaymentStatus> {
    const status = this.deps.payment.capability();
    if (status.availability !== 'available') throw new CapabilityUnavailableError(status);
    const payment = paymentStatusSchema.parse(await this.deps.payment.getPaymentStatus(organizationId));
    await this.deps.store.put('payment_status', `${organizationId}:${payment.checked_at}`, payment);
    await this.deps.audit.append({
      account_id: accountId,
      organization_id: organizationId,
      actor,
      action: 'payment.status.refresh',
      target_type: 'payment_status',
      target_id: `${organizationId}:${payment.checked_at}`,
      outcome: 'succeeded',
      request_id: requestId,
      occurred_at: payment.checked_at,
      detail: { state: payment.state, provider: payment.provider },
    });
    return payment;
  }
}
