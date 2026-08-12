import {
  capabilityStatusSchema,
  invoiceSchema,
  nowIsoDateTime,
  paymentStatusSchema,
  type CapabilityStatus,
  type Invoice,
  type OrganizationId,
  type PaymentStatus,
} from '@spiderbyte/commercial-domain';
import {
  CapabilityUnavailableError,
  type Clock,
  type IdGenerator,
  type PaymentAdapter,
} from '@spiderbyte/commercial-ports';

const defaultTestClock: Clock = { now: nowIsoDateTime };
const defaultTestIds: IdGenerator = { next: (prefix) => `${prefix}local-test` };

/** Deterministic adapter for tests and local control-plane development only. */
export class LocalTestPaymentAdapter implements PaymentAdapter {
  readonly adapter_name = 'local-test-payment';

  constructor(
    private readonly clock: Clock = defaultTestClock,
    private readonly ids: IdGenerator = defaultTestIds,
  ) {}

  capability(): CapabilityStatus {
    return capabilityStatusSchema.parse({
      capability: 'payment',
      availability: 'available',
      adapter: this.adapter_name,
      reason: 'deterministic test payment adapter; not a production payment provider',
      checked_at: this.clock.now(),
    });
  }

  async createInvoice(input: {
    readonly account_id: string;
    readonly organization_id: OrganizationId;
    readonly period_id: string;
    readonly invoice_id: string;
    readonly currency: string;
    readonly subtotal_minor: number;
    readonly tax_minor: number;
    readonly total_minor: number;
    readonly amount_due_minor: number;
    readonly request_id: string;
  }): Promise<Invoice> {
    const now = this.clock.now();
    return invoiceSchema.parse({
      id: input.invoice_id || this.ids.next('inv_'),
      account_id: input.account_id,
      organization_id: input.organization_id,
      billing_period_id: input.period_id,
      state: 'open',
      currency: input.currency,
      subtotal_minor: input.subtotal_minor,
      tax_minor: input.tax_minor,
      total_minor: input.total_minor,
      amount_due_minor: input.amount_due_minor,
      external_invoice_ref: `test-invoice:${input.invoice_id}`,
      version: 1,
      created_at: now,
      updated_at: now,
      created_by: { kind: 'system', id: 'local-test-payment' },
      updated_by: { kind: 'system', id: 'local-test-payment' },
    });
  }

  async getPaymentStatus(organizationId: OrganizationId): Promise<PaymentStatus> {
    return paymentStatusSchema.parse({
      account_id: 'acct_local_test',
      organization_id: organizationId,
      state: 'succeeded',
      provider: this.adapter_name,
      checked_at: this.clock.now(),
    });
  }
}

export class UnavailablePaymentAdapter implements PaymentAdapter {
  readonly adapter_name = 'unavailable-payment';

  constructor(
    private readonly availability: 'not_configured' | 'temporarily_unavailable' | 'not_implemented' = 'not_configured',
    private readonly reason = 'a production payment provider is not configured',
  ) {}

  capability(): CapabilityStatus {
    return capabilityStatusSchema.parse({
      capability: 'payment',
      availability: this.availability,
      adapter: this.adapter_name,
      reason: this.reason,
      checked_at: nowIsoDateTime(),
    });
  }

  async createInvoice(_input: Parameters<PaymentAdapter['createInvoice']>[0]): Promise<Invoice> {
    throw new CapabilityUnavailableError(this.capability());
  }

  async getPaymentStatus(_organizationId: OrganizationId): Promise<PaymentStatus> {
    throw new CapabilityUnavailableError(this.capability());
  }
}
