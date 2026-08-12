import {
  capabilityStatusSchema,
  computeExecutionSchema,
  nowIsoDateTime,
  type CapabilityStatus,
  type ComputeExecution,
  type OrganizationId,
  type WorkspaceId,
} from '@spiderbyte/commercial-domain';
import {
  CapabilityUnavailableError,
  type HostedComputeAdapter,
} from '@spiderbyte/commercial-ports';

/** Deterministic worker double. It only reports states explicitly set by the test. */
export class LocalTestComputeAdapter implements HostedComputeAdapter {
  readonly adapter_name = 'local-test-compute';
  private readonly executions = new Map<string, ComputeExecution>();

  capability(): CapabilityStatus {
    return capabilityStatusSchema.parse({
      capability: 'hosted_compute',
      availability: 'available',
      adapter: this.adapter_name,
      reason: 'deterministic local worker adapter; not a production worker fleet',
      checked_at: nowIsoDateTime(),
    });
  }

  async submit(input: {
    readonly organization_id: OrganizationId;
    readonly workspace_id: WorkspaceId;
    readonly reservation_id: string;
    readonly request_id: string;
  }): Promise<ComputeExecution> {
    const now = nowIsoDateTime();
    const execution = computeExecutionSchema.parse({
      id: `exec_test_${this.executions.size + 1}`,
      reservation_id: input.reservation_id,
      account_id: 'acct_local_test',
      organization_id: input.organization_id,
      workspace_id: input.workspace_id,
      state: 'starting',
      worker_execution_ref: `local-worker:${input.reservation_id}`,
      heartbeat_at: now,
      started_at: now,
      retry_count: 0,
      version: 1,
      created_at: now,
      updated_at: now,
      created_by: { kind: 'system', id: 'local-test-worker' },
      updated_by: { kind: 'system', id: 'local-test-worker' },
    });
    this.executions.set(execution.id, execution);
    return execution;
  }

  async cancel(input: { readonly execution_id: string; readonly request_id: string }): Promise<ComputeExecution> {
    const current = this.executions.get(input.execution_id);
    if (current === undefined) throw new Error('test execution not found');
    const now = nowIsoDateTime();
    const canceled = computeExecutionSchema.parse({
      ...current,
      state: 'canceled',
      completed_at: now,
      heartbeat_at: now,
      version: current.version + 1,
      updated_at: now,
      updated_by: { kind: 'system', id: 'local-test-worker' },
    });
    this.executions.set(canceled.id, canceled);
    return canceled;
  }

  async inspect(executionId: string): Promise<ComputeExecution | undefined> {
    const execution = this.executions.get(executionId);
    return execution === undefined ? undefined : structuredClone(execution);
  }

  setState(executionId: string, state: ComputeExecution['state']): void {
    const current = this.executions.get(executionId);
    if (current === undefined) throw new Error('test execution not found');
    const now = nowIsoDateTime();
    this.executions.set(executionId, computeExecutionSchema.parse({
      ...current,
      state,
      heartbeat_at: now,
      completed_at: ['succeeded', 'failed', 'canceled', 'timed_out', 'reconciliation_required'].includes(state) ? now : current.completed_at,
      version: current.version + 1,
      updated_at: now,
      updated_by: { kind: 'system', id: 'local-test-worker' },
    }));
  }
}

export class UnavailableComputeAdapter implements HostedComputeAdapter {
  readonly adapter_name = 'unavailable-compute';

  capability(): CapabilityStatus {
    return capabilityStatusSchema.parse({
      capability: 'hosted_compute',
      availability: 'not_configured',
      adapter: this.adapter_name,
      reason: 'hosted worker fleet is not configured',
      checked_at: nowIsoDateTime(),
    });
  }

  async submit(_input: Parameters<HostedComputeAdapter['submit']>[0]): Promise<ComputeExecution> {
    throw new CapabilityUnavailableError(this.capability());
  }

  async cancel(_input: Parameters<HostedComputeAdapter['cancel']>[0]): Promise<ComputeExecution> {
    throw new CapabilityUnavailableError(this.capability());
  }

  async inspect(_executionId: string): Promise<ComputeExecution | undefined> {
    throw new CapabilityUnavailableError(this.capability());
  }
}
