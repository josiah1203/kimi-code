import type {
  AccountId,
  ComputeExecution,
  Invoice,
  OrganizationId,
  PaymentStatus,
  UsagePriceBasis,
  WorkspaceId,
} from '@spiderbyte/commercial-domain';

import type { CapabilityAdapter } from './platform';

export interface PaymentAdapter extends CapabilityAdapter {
  createInvoice(input: {
    readonly account_id: AccountId;
    readonly organization_id: OrganizationId;
    readonly period_id: string;
    readonly invoice_id: string;
    readonly currency: string;
    readonly subtotal_minor: number;
    readonly tax_minor: number;
    readonly total_minor: number;
    readonly amount_due_minor: number;
    readonly request_id: string;
  }): Promise<Invoice>;
  getPaymentStatus(organizationId: OrganizationId): Promise<PaymentStatus>;
}

export interface HostedComputeAdapter extends CapabilityAdapter {
  submit(input: {
    readonly organization_id: OrganizationId;
    readonly workspace_id: WorkspaceId;
    readonly reservation_id: string;
    readonly request_id: string;
  }): Promise<ComputeExecution>;
  cancel(input: { readonly execution_id: string; readonly request_id: string }): Promise<ComputeExecution>;
  inspect(executionId: string): Promise<ComputeExecution | undefined>;
  /** Optional provider-reported usage used by the control plane for reconciliation. */
  usage?(executionId: string): Promise<HostedComputeUsage | undefined>;
}

export interface HostedComputeUsage {
  readonly actual_amount: number;
  readonly unit: 'seconds';
}

/** Provider-neutral execution target contract used by hosted and customer-managed workers. */
export interface ExecutionTarget extends HostedComputeAdapter {}

/** Server-owned price quote boundary; callers must not provide billing rates. */
export interface HostedComputePricing extends CapabilityAdapter {
  quote(input: {
    readonly organization_id: OrganizationId;
    readonly workspace_id: WorkspaceId;
    readonly provider_id: string;
    readonly region_id: string;
    readonly job_class_id: string;
    readonly requested_seconds: number;
  }): Promise<UsagePriceBasis>;
}

export interface HostedArtifactAdapter extends CapabilityAdapter {
  put(input: {
    readonly artifact_id: string;
    readonly organization_id: OrganizationId;
    readonly workspace_id: WorkspaceId;
    readonly content_address: string;
    readonly bytes: Uint8Array;
    readonly request_id: string;
  }): Promise<{ readonly object_ref: string }>;
  delete(input: {
    readonly organization_id: OrganizationId;
    readonly workspace_id: WorkspaceId;
    readonly object_ref: string;
    readonly request_id: string;
  }): Promise<void>;
  issueDownload(input: {
    readonly organization_id: OrganizationId;
    readonly workspace_id: WorkspaceId;
    readonly artifact_id: string;
    readonly expires_at: string;
  }): Promise<{ readonly url: string; readonly expires_at: string }>;
}
