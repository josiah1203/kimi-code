import { createHash } from 'node:crypto';

import {
  computeExecutionSchema,
  computeProviderSchema,
  computeRegionSchema,
  computeReservationSchema,
  jobClassSchema,
  type ActorRef,
  type ComputeExecution,
  type ComputeProvider,
  type ComputeRegion,
  type ComputeReservation,
  type JobClass,
  type Principal,
} from '@spiderbyte/commercial-domain';
import {
  CapabilityUnavailableError,
  type AuditWriter,
  type Clock,
  type CommercialStore,
  type HostedComputeAdapter,
  type IdGenerator,
} from '@spiderbyte/commercial-ports';
import {
  CommercialEntitlementService,
  UsageLedgerService,
} from '@spiderbyte/commercial-billing';

import { CommercialComputeCodes, CommercialComputeError } from './errors';

export interface ComputeAuthorizationGate {
  authorize(
    principal: Principal,
    organizationId: string,
    action: 'compute.submit' | 'compute.cancel',
    requestId: string,
    workspaceId: string,
  ): Promise<void>;
}

export interface ComputeControlPlaneDependencies {
  readonly store: CommercialStore;
  readonly adapter: HostedComputeAdapter;
  readonly entitlement: CommercialEntitlementService;
  readonly usage: UsageLedgerService;
  readonly authorize: ComputeAuthorizationGate;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly audit: AuditWriter;
}

export interface RegisterProviderInput {
  readonly account_id: string;
  readonly organization_id?: string;
  readonly name: string;
  readonly provider_type: ComputeProvider['provider_type'];
  readonly supported_regions: readonly string[];
  readonly capabilities: readonly string[];
  readonly actor: ActorRef;
  readonly request_id: string;
}

export interface RegisterRegionInput {
  readonly account_id: string;
  readonly organization_id?: string;
  readonly provider_id: string;
  readonly name: string;
  readonly residency: string;
  readonly actor: ActorRef;
  readonly request_id: string;
}

export interface RegisterJobClassInput {
  readonly account_id: string;
  readonly organization_id?: string;
  readonly name: string;
  readonly cpu_millis: number;
  readonly gpu_count: number;
  readonly memory_bytes: number;
  readonly storage_bytes: number;
  readonly actor: ActorRef;
  readonly request_id: string;
}

export interface SubmitComputeInput {
  readonly principal: Principal;
  readonly account_id: string;
  readonly organization_id: string;
  readonly workspace_id: string;
  readonly provider_id: string;
  readonly region_id: string;
  readonly job_class_id: string;
  readonly run_id?: string;
  readonly attempt_id?: string;
  readonly requested_seconds: number;
  readonly price_basis: {
    readonly unit_price_minor: number;
    readonly multiplier: number;
    readonly currency: string;
    readonly price_book_id: string;
  };
  readonly actor: ActorRef;
  readonly request_id: string;
  readonly timeout_at?: string;
}

export class HostedComputeControlPlane {
  constructor(private readonly deps: ComputeControlPlaneDependencies) {}

  async registerProvider(input: RegisterProviderInput): Promise<ComputeProvider> {
    const now = this.deps.clock.now();
    const provider = computeProviderSchema.parse({
      id: this.deps.ids.next('compute_'),
      account_id: input.account_id,
      organization_id: input.organization_id,
      name: input.name,
      provider_type: input.provider_type,
      state: this.deps.adapter.capability().availability === 'available' ? 'ready' : 'unavailable',
      supported_regions: input.supported_regions,
      capabilities: input.capabilities,
      version: 1,
      created_at: now,
      updated_at: now,
      created_by: input.actor,
      updated_by: input.actor,
    });
    await this.deps.store.put('compute_providers', provider.id, provider);
    await this.deps.audit.append({
      account_id: input.account_id,
      organization_id: input.organization_id,
      actor: input.actor,
      action: 'compute.provider.register',
      target_type: 'compute_provider',
      target_id: provider.id,
      outcome: 'succeeded',
      request_id: input.request_id,
      occurred_at: now,
      detail: { state: provider.state, provider_type: provider.provider_type },
    });
    return provider;
  }

  async registerRegion(input: RegisterRegionInput): Promise<ComputeRegion> {
    const provider = await this.deps.store.get('compute_providers', input.provider_id);
    if (provider === undefined) throw new CommercialComputeError(CommercialComputeCodes.PROVIDER_NOT_FOUND, 'compute provider not found');
    if (provider.account_id !== input.account_id || provider.organization_id !== input.organization_id) {
      throw new CommercialComputeError(CommercialComputeCodes.PROVIDER_NOT_FOUND, 'compute provider is not available to this organization');
    }
    const now = this.deps.clock.now();
    const region = computeRegionSchema.parse({
      id: this.deps.ids.next('region_'),
      account_id: input.account_id,
      organization_id: input.organization_id,
      provider_id: provider.id,
      name: input.name,
      state: provider.state === 'ready' ? 'available' : 'unavailable',
      residency: input.residency,
      version: 1,
      created_at: now,
      updated_at: now,
      created_by: input.actor,
      updated_by: input.actor,
    });
    await this.deps.store.put('compute_regions', region.id, region);
    return region;
  }

  async registerJobClass(input: RegisterJobClassInput): Promise<JobClass> {
    const now = this.deps.clock.now();
    const jobClass = jobClassSchema.parse({
      id: this.deps.ids.next('jobclass_'),
      account_id: input.account_id,
      organization_id: input.organization_id,
      name: input.name,
      cpu_millis: input.cpu_millis,
      gpu_count: input.gpu_count,
      memory_bytes: input.memory_bytes,
      storage_bytes: input.storage_bytes,
      state: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
      created_by: input.actor,
      updated_by: input.actor,
    });
    await this.deps.store.put('job_classes', jobClass.id, jobClass);
    return jobClass;
  }

  async submit(input: SubmitComputeInput): Promise<ComputeReservation> {
    await this.deps.authorize.authorize(input.principal, input.organization_id, 'compute.submit', input.request_id, input.workspace_id);
    const fingerprint = hashJson({
      account_id: input.account_id,
      organization_id: input.organization_id,
      workspace_id: input.workspace_id,
      provider_id: input.provider_id,
      region_id: input.region_id,
      job_class_id: input.job_class_id,
      run_id: input.run_id,
      attempt_id: input.attempt_id,
      requested_seconds: input.requested_seconds,
      price_basis: input.price_basis,
      timeout_at: input.timeout_at,
    });
    const replay = await this.replayReservation(input.request_id, fingerprint);
    if (replay !== undefined) return replay;
    await this.deps.entitlement.assertIncluded(input.organization_id, 'hosted_compute');
    if (!Number.isFinite(input.requested_seconds) || input.requested_seconds <= 0) {
      throw new CommercialComputeError(CommercialComputeCodes.INVALID_LIFECYCLE, 'requested compute duration must be positive');
    }
    const provider = await this.deps.store.get('compute_providers', input.provider_id);
    if (provider === undefined || provider.account_id !== input.account_id || provider.organization_id !== undefined && provider.organization_id !== input.organization_id) {
      throw new CommercialComputeError(CommercialComputeCodes.PROVIDER_NOT_FOUND, 'compute provider is not available to this organization');
    }
    if (provider.state !== 'ready') {
      throw new CommercialComputeError(CommercialComputeCodes.PROVIDER_UNAVAILABLE, 'compute provider is not ready');
    }
    const region = await this.deps.store.get('compute_regions', input.region_id);
    if (region === undefined || region.account_id !== input.account_id || region.organization_id !== input.organization_id || region.provider_id !== provider.id || region.state !== 'available') {
      throw new CommercialComputeError(CommercialComputeCodes.REGION_NOT_FOUND, 'compute region is not available');
    }
    const jobClass = await this.deps.store.get('job_classes', input.job_class_id);
    if (jobClass === undefined || jobClass.account_id !== input.account_id || jobClass.state !== 'active' || jobClass.organization_id !== undefined && jobClass.organization_id !== input.organization_id) {
      throw new CommercialComputeError(CommercialComputeCodes.JOB_CLASS_NOT_FOUND, 'job class is not available');
    }
    const now = this.deps.clock.now();
    let reservation = computeReservationSchema.parse({
      id: this.deps.ids.next('reserve_'),
      account_id: input.account_id,
      organization_id: input.organization_id,
      workspace_id: input.workspace_id,
      provider_id: provider.id,
      region_id: region.id,
      job_class_id: jobClass.id,
      run_id: input.run_id,
      attempt_id: input.attempt_id,
      state: 'requested',
      requested_at: now,
      version: 1,
      created_at: now,
      updated_at: now,
      created_by: input.actor,
      updated_by: input.actor,
    });
    await this.deps.store.put('compute_reservations', reservation.id, reservation);
    reservation = await this.transition(reservation, 'authorized', input.actor, input.request_id);
    const usage = await this.deps.usage.recordUsage({
      account_id: input.account_id,
      organization_id: input.organization_id,
      workspace_id: input.workspace_id,
      run_id: input.run_id,
      attempt_id: input.attempt_id,
      resource_type: 'hosted_compute',
      reserved_amount: input.requested_seconds,
      actual_amount: 0,
      unit: 'seconds',
      price_basis: input.price_basis,
      idempotency_key: `compute:${reservation.id}`,
      source_event_id: `compute-request:${reservation.id}`,
      source: 'api',
      actor: input.actor,
      request_id: `${input.request_id}:usage`,
    });
    reservation = computeReservationSchema.parse({
      ...await this.transition(reservation, 'budget_approved', input.actor, input.request_id),
      usage_event_id: usage.id,
    });
    await this.deps.store.put('compute_reservations', reservation.id, reservation);
    reservation = await this.transition(reservation, 'queued', input.actor, input.request_id);
    const capability = this.deps.adapter.capability();
    if (capability.availability !== 'available') {
      await this.deps.usage.reconcileUsage({
        usage_event_id: usage.id,
        actual_amount: 0,
        actor: input.actor,
        request_id: `${input.request_id}:release`,
      });
      const unavailable = await this.failReservation(reservation, 'provider_unavailable', input.actor, input.request_id, 'unavailable');
      await this.rememberReservation(input.request_id, fingerprint, unavailable);
      return unavailable;
    }
    try {
      const execution = computeExecutionSchema.parse(await this.deps.adapter.submit({
        organization_id: input.organization_id,
        workspace_id: input.workspace_id,
        reservation_id: reservation.id,
        request_id: input.request_id,
      }));
      if (execution.reservation_id !== reservation.id || !['starting', 'running', 'queued', 'reserved'].includes(execution.state)) {
        const invalid = await this.failReservation(reservation, 'provider_returned_invalid_state', input.actor, input.request_id, 'failed');
        await this.rememberReservation(input.request_id, fingerprint, invalid);
        return invalid;
      }
      const confirmed = computeReservationSchema.parse({
        ...reservation,
        state: execution.state,
        confirmed_at: this.deps.clock.now(),
        version: reservation.version + 1,
        updated_at: this.deps.clock.now(),
        updated_by: input.actor,
      });
      await this.deps.store.put('compute_executions', execution.id, execution);
      await this.deps.store.put('compute_reservations', confirmed.id, confirmed);
      await this.auditLifecycle(confirmed, input.actor, input.request_id, execution.state);
      await this.rememberReservation(input.request_id, fingerprint, confirmed);
      return confirmed;
    } catch (error) {
      await this.deps.usage.reconcileUsage({
        usage_event_id: usage.id,
        actual_amount: 0,
        actor: input.actor,
        request_id: `${input.request_id}:release`,
      });
      const failed = await this.failReservation(
        reservation,
        error instanceof CapabilityUnavailableError ? 'provider_unavailable' : 'provider_submit_failed',
        input.actor,
        input.request_id,
        error instanceof CapabilityUnavailableError ? 'unavailable' : 'failed',
      );
      await this.rememberReservation(input.request_id, fingerprint, failed);
      return failed;
    }
  }

  async refresh(principal: Principal, organizationId: string, workspaceId: string, executionId: string, requestId: string): Promise<ComputeExecution> {
    await this.deps.authorize.authorize(principal, organizationId, 'compute.submit', requestId, workspaceId);
    const execution = await this.deps.store.get('compute_executions', executionId);
    if (execution === undefined || execution.organization_id !== organizationId || execution.workspace_id !== workspaceId) {
      throw new CommercialComputeError(CommercialComputeCodes.EXECUTION_NOT_FOUND, 'compute execution not found');
    }
    const current = await this.deps.adapter.inspect(execution.id);
    if (current === undefined) {
      const reservation = await this.deps.store.get('compute_reservations', execution.reservation_id);
      if (reservation !== undefined) await this.failReservation(reservation, 'provider_lost_lease', { kind: 'system', id: 'compute-reconciler' }, requestId, 'reconciliation_required');
      throw new CommercialComputeError(CommercialComputeCodes.EXECUTION_NOT_FOUND, 'provider did not confirm the execution');
    }
    const checked = computeExecutionSchema.parse(current);
    await this.deps.store.put('compute_executions', checked.id, checked);
    const reservation = await this.deps.store.get('compute_reservations', checked.reservation_id);
    if (reservation !== undefined && reservation.state !== checked.state) {
      await this.deps.store.put('compute_reservations', reservation.id, computeReservationSchema.parse({
        ...reservation,
        state: checked.state,
        finished_at: ['succeeded', 'failed', 'canceled', 'timed_out', 'reconciliation_required'].includes(checked.state) ? this.deps.clock.now() : reservation.finished_at,
        version: reservation.version + 1,
        updated_at: this.deps.clock.now(),
        updated_by: { kind: 'system', id: 'compute-reconciler' },
      }));
    }
    return checked;
  }

  async cancel(input: { readonly principal: Principal; readonly organization_id: string; readonly workspace_id: string; readonly execution_id: string; readonly actor: ActorRef; readonly request_id: string }): Promise<ComputeExecution> {
    await this.deps.authorize.authorize(input.principal, input.organization_id, 'compute.cancel', input.request_id, input.workspace_id);
    const execution = await this.deps.store.get('compute_executions', input.execution_id);
    if (execution === undefined || execution.organization_id !== input.organization_id || execution.workspace_id !== input.workspace_id) {
      throw new CommercialComputeError(CommercialComputeCodes.EXECUTION_NOT_FOUND, 'compute execution not found');
    }
    if (['succeeded', 'failed', 'canceled', 'timed_out'].includes(execution.state)) return execution;
    const canceled = computeExecutionSchema.parse(await this.deps.adapter.cancel({ execution_id: execution.id, request_id: input.request_id }));
    await this.deps.store.put('compute_executions', canceled.id, canceled);
    const reservation = await this.deps.store.get('compute_reservations', execution.reservation_id);
    if (reservation?.usage_event_id !== undefined) await this.deps.usage.reconcileUsage({
      usage_event_id: reservation.usage_event_id,
      actual_amount: 0,
      actor: input.actor,
      request_id: `${input.request_id}:release`,
    });
    if (reservation !== undefined) await this.deps.store.put('compute_reservations', reservation.id, computeReservationSchema.parse({
      ...reservation,
      state: 'canceled',
      finished_at: this.deps.clock.now(),
      version: reservation.version + 1,
      updated_at: this.deps.clock.now(),
      updated_by: input.actor,
    }));
    return canceled;
  }

  private async transition(reservation: ComputeReservation, state: ComputeReservation['state'], actor: ActorRef, requestId: string): Promise<ComputeReservation> {
    const updated = computeReservationSchema.parse({
      ...reservation,
      state,
      version: reservation.version + 1,
      updated_at: this.deps.clock.now(),
      updated_by: actor,
    });
    await this.deps.store.put('compute_reservations', updated.id, updated);
    await this.auditLifecycle(updated, actor, requestId, state);
    return updated;
  }

  private async failReservation(
    reservation: ComputeReservation,
    failureCode: string,
    actor: ActorRef,
    requestId: string,
    state: 'failed' | 'unavailable' | 'reconciliation_required',
  ): Promise<ComputeReservation> {
    const failed = computeReservationSchema.parse({
      ...reservation,
      state,
      failure_code: failureCode,
      finished_at: this.deps.clock.now(),
      version: reservation.version + 1,
      updated_at: this.deps.clock.now(),
      updated_by: actor,
    });
    await this.deps.store.put('compute_reservations', failed.id, failed);
    await this.auditLifecycle(failed, actor, requestId, state);
    return failed;
  }

  private async auditLifecycle(reservation: ComputeReservation, actor: ActorRef, requestId: string, state: string): Promise<void> {
    await this.deps.audit.append({
      account_id: reservation.account_id,
      organization_id: reservation.organization_id,
      workspace_id: reservation.workspace_id,
      actor,
      action: `compute.reservation.${state}`,
      target_type: 'compute_reservation',
      target_id: reservation.id,
      outcome: state === 'failed' || state === 'unavailable' || state === 'reconciliation_required' ? 'failed' : 'succeeded',
      request_id: requestId,
      occurred_at: this.deps.clock.now(),
      detail: { state, provider_id: reservation.provider_id },
    });
  }

  private async replayReservation(requestId: string, fingerprint: string): Promise<ComputeReservation | undefined> {
    const record = await this.deps.store.get('idempotency', `compute.submit:${requestId}`);
    if (record === undefined) return undefined;
    if (record.fingerprint !== fingerprint) throw new CommercialComputeError(CommercialComputeCodes.IDEMPOTENCY_REUSED, 'request id was reused with different compute input');
    return JSON.parse(record.result_json) as ComputeReservation;
  }

  private async rememberReservation(requestId: string, fingerprint: string, reservation: ComputeReservation): Promise<void> {
    await this.deps.store.put('idempotency', `compute.submit:${requestId}`, {
      scope: 'compute.submit',
      request_id: requestId,
      fingerprint,
      result_json: JSON.stringify(reservation),
      created_at: this.deps.clock.now(),
    });
  }
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
