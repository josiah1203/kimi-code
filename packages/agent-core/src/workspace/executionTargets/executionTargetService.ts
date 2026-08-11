/** Durable execution targets with policy-gated leases and opaque credentials. */

import { ulid } from 'ulid';
import { z } from 'zod';

import { Disposable } from '#/_base/di/lifecycle';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { Emitter, type Event } from '#/_base/event';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import { IWorkspacePlatformEventService } from '#/workspace/platformEvents/platformEvents';
import { IWorkspacePolicyService } from '#/workspace/policy/policy';
import {
  executionLeaseAcquireInputSchema,
  executionLeaseReleaseInputSchema,
  executionLeaseSchema,
  executionTargetCommandInputSchema,
  executionTargetCreateInputSchema,
  executionTargetSchema,
  executionTargetUpdateInputSchema,
  nowIsoDateTime,
  type ExecutionLease,
  type ExecutionLeaseAcquireInput,
  type ExecutionLeaseReleaseInput,
  type ExecutionTarget,
  type ExecutionTargetCommandInput,
  type ExecutionTargetCreateInput,
  type ExecutionTargetUpdateInput,
} from '@spiderbyte/protocol';

import {
  IWorkspaceExecutionTargetService,
  type WorkspaceExecutionTargetsChangedEvent,
} from './executionTarget';
import { ExecutionTargetErrors, ExecutionTargetServiceError } from './errors';
import { findSensitivePlatformMetadataPath } from '#/workspace/platformServices/metadata';

const TARGET_KEY = 'execution-targets.json';
const DOCUMENT_VERSION = 1;

const documentSchema = z.strictObject({
  version: z.literal(DOCUMENT_VERSION),
  targets: z.array(executionTargetSchema),
  leases: z.array(executionLeaseSchema),
  requests: z.record(z.string(), z.string()).default({}),
});

type TargetDocument = z.infer<typeof documentSchema>;

export class WorkspaceExecutionTargetService
  extends Disposable
  implements IWorkspaceExecutionTargetService
{
  declare readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  readonly onDidChange: Event<WorkspaceExecutionTargetsChangedEvent>;

  private readonly changes = this._register(new Emitter<WorkspaceExecutionTargetsChangedEvent>());
  private readonly scope: string;
  private targets: readonly ExecutionTarget[] = [];
  private leases: readonly ExecutionLease[] = [];
  private requests: Record<string, string> = {};
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    @IAtomicDocumentStore private readonly store: IAtomicDocumentStore,
    @IWorkspaceContext private readonly context: IWorkspaceContext,
    @IWorkspacePolicyService private readonly policy: IWorkspacePolicyService,
    @IWorkspacePlatformEventService private readonly events: IWorkspacePlatformEventService,
  ) {
    super();
    this.scope = `${context.persistenceScope}/platform`;
    this.onDidChange = this.changes.event;
    this.ready = this.load();
  }

  async list(): Promise<readonly ExecutionTarget[]> {
    await this.ready;
    return [...this.targets];
  }

  async get(id: string): Promise<ExecutionTarget | undefined> {
    await this.ready;
    return this.targets.find((target) => target.id === id);
  }

  async register(input: ExecutionTargetCreateInput): Promise<ExecutionTarget> {
    const command = executionTargetCreateInputSchema.parse(input);
    assertCredentialReference(command.credential_ref);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const existingId = this.requests[command.request_id];
      if (existingId !== undefined) return this.require(existingId);
      if (this.targets.some((target) => target.name === command.name)) {
        throw new ExecutionTargetServiceError(
          ExecutionTargetErrors.codes.EXECUTION_TARGET_NAME_TAKEN,
          `execution target name already exists: ${command.name}`,
          { name: command.name },
        );
      }
      const now = nowIsoDateTime();
      const { request_id: _requestId, ...inputWithoutRequest } = command;
      const target = executionTargetSchema.parse({
        ...inputWithoutRequest,
        id: `target_${ulid()}`,
        workspace_id: this.context.workspaceId,
        state: 'configured',
        created_at: now,
        updated_at: now,
      });
      await this.replace([...this.targets, target], this.leases, {
        ...this.requests,
        [command.request_id]: target.id,
      });
      await this.events.append({
        event_type: 'execution_target.created',
        entity_type: 'execution_target',
        entity_id: target.id,
        request_id: command.request_id,
        actor: 'user',
        state: target.state,
        payload: { type: target.type, locality: target.locality },
      });
      this.changes.fire({ target, kind: 'created' });
      return target;
    });
  }

  async update(id: string, input: ExecutionTargetUpdateInput): Promise<ExecutionTarget | undefined> {
    const command = executionTargetUpdateInputSchema.parse(input);
    assertCredentialReference(command.credential_ref);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const current = this.require(id);
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.require(mapped);
      const { request_id: _requestId, ...patch } = command;
      const target = executionTargetSchema.parse({ ...current, ...patch, updated_at: nowIsoDateTime() });
      await this.replace(
        this.targets.map((candidate) => (candidate.id === id ? target : candidate)),
        this.leases,
        { ...this.requests, [command.request_id]: id },
      );
      await this.events.append({
        event_type: target.state === current.state ? 'execution_target.updated' : 'execution_target.state_changed',
        entity_type: 'execution_target',
        entity_id: id,
        request_id: command.request_id,
        actor: 'user',
        state: target.state,
      });
      this.changes.fire({ target, kind: 'updated' });
      return target;
    });
  }

  async markReady(id: string, input: ExecutionTargetCommandInput): Promise<ExecutionTarget | undefined> {
    return this.setState(id, executionTargetCommandInputSchema.parse(input), 'ready');
  }

  async disable(id: string, input: ExecutionTargetCommandInput): Promise<ExecutionTarget | undefined> {
    return this.setState(id, executionTargetCommandInputSchema.parse(input), 'disabled');
  }

  async getLease(targetId: string, leaseId: string): Promise<ExecutionLease | undefined> {
    await this.ready;
    return this.leases.find((lease) => lease.id === leaseId && lease.target_id === targetId);
  }

  async acquireLease(id: string, input: ExecutionLeaseAcquireInput): Promise<ExecutionLease> {
    const command = executionLeaseAcquireInputSchema.parse(input);
    return this.enqueue(async () => {
      await this.ready;
      const existingId = this.requests[command.request_id];
      if (existingId !== undefined) return this.requireLease(existingId);
      const target = this.require(id);
      if (target.state !== 'ready') {
        throw new ExecutionTargetServiceError(
          ExecutionTargetErrors.codes.EXECUTION_TARGET_INVALID_STATE,
          `execution target is not ready: ${id}`,
          { id, state: target.state },
        );
      }
      const nowDate = new Date();
      const now = nowDate.toISOString();
      const active = this.leases.find(
        (lease) => lease.target_id === id && lease.state === 'active' && new Date(lease.expires_at) > nowDate,
      );
      if (active !== undefined) {
        throw new ExecutionTargetServiceError(
          ExecutionTargetErrors.codes.EXECUTION_TARGET_LEASE_BUSY,
          `execution target lease is busy: ${id}`,
          { id },
        );
      }

      let policyDecisionId: string | undefined;
      let state: ExecutionLease['state'] = 'active';
      if (target.type !== 'local') {
        const action = `lease:${target.type}:${target.name}`;
        const decision = command.policy_decision_id === undefined
          ? await this.policy.evaluate({
            request_id: `target_policy_${command.request_id}`,
            run_id: command.run_id,
            capability: 'cloud',
            action,
            requested_by: 'agent',
            metadata: { execution_target_id: id, locality: target.locality },
          })
          : await this.policy.assertUsable(command.policy_decision_id, {
            capability: 'cloud',
            action,
            run_id: command.run_id,
          });
        policyDecisionId = decision.id;
        if (decision.outcome === 'deny' || decision.state === 'denied') {
          throw new ExecutionTargetServiceError(
            ExecutionTargetErrors.codes.EXECUTION_TARGET_POLICY_DENIED,
            decision.reason,
            { policy_decision_id: decision.id },
          );
        }
        if (decision.outcome === 'approval_required' && command.policy_decision_id === undefined) {
          state = 'awaiting_approval';
        }
      } else if (command.policy_decision_id !== undefined) {
        throw new ExecutionTargetServiceError(
          ExecutionTargetErrors.codes.EXECUTION_TARGET_POLICY_DENIED,
          'local execution targets do not accept cloud policy decisions',
          { policy_decision_id: command.policy_decision_id },
        );
      }
      const expires = new Date(nowDate.getTime() + command.duration_seconds * 1000).toISOString();
      const lease = executionLeaseSchema.parse({
        id: `lease_${ulid()}`,
        workspace_id: this.context.workspaceId,
        target_id: id,
        run_id: command.run_id,
        lease_ref: `lease_ref_${ulid()}`,
        state,
        issued_at: now,
        expires_at: expires,
        policy_decision_id: policyDecisionId,
      });
      const nextTarget = executionTargetSchema.parse({
        ...target,
        lease_ref: lease.lease_ref,
        updated_at: now,
      });
      await this.replace(
        this.targets.map((candidate) => (candidate.id === id ? nextTarget : candidate)),
        [...this.leases, lease],
        { ...this.requests, [command.request_id]: lease.id },
      );
      await this.events.append({
        event_type: 'execution_target.updated',
        entity_type: 'execution_target',
        entity_id: id,
        request_id: command.request_id,
        actor: 'agent',
        state: lease.state,
        payload: { lease_id: lease.id, policy_decision_id: policyDecisionId },
      });
      this.changes.fire({ target: nextTarget, kind: 'lease_changed', lease });
      return lease;
    });
  }

  async releaseLease(
    id: string,
    leaseId: string,
    input: ExecutionLeaseReleaseInput,
  ): Promise<ExecutionLease | undefined> {
    const command = executionLeaseReleaseInputSchema.parse(input);
    return this.enqueue(async () => {
      await this.ready;
      const lease = this.leases.find((candidate) => candidate.id === leaseId && candidate.target_id === id);
      if (lease === undefined) return undefined;
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.requireLease(mapped);
      if (lease.state === 'released') return lease;
      const next = executionLeaseSchema.parse({
        ...lease,
        state: 'released',
        released_at: nowIsoDateTime(),
      });
      const target = this.require(id);
      const nextTarget = executionTargetSchema.parse({
        ...target,
        lease_ref: undefined,
        updated_at: next.released_at,
      });
      await this.replace(
        this.targets.map((candidate) => (candidate.id === id ? nextTarget : candidate)),
        this.leases.map((candidate) => (candidate.id === leaseId ? next : candidate)),
        { ...this.requests, [command.request_id]: leaseId },
      );
      await this.events.append({
        event_type: 'execution_target.updated',
        entity_type: 'execution_target',
        entity_id: id,
        request_id: command.request_id,
        actor: 'system',
        state: next.state,
        payload: { lease_id: leaseId },
      });
      this.changes.fire({ target: nextTarget, kind: 'lease_changed', lease: next });
      return next;
    });
  }

  private async setState(
    id: string,
    command: ExecutionTargetCommandInput,
    state: ExecutionTarget['state'],
  ): Promise<ExecutionTarget | undefined> {
    return this.enqueue(async () => {
      await this.ready;
      const current = this.require(id);
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.require(mapped);
      if (state === 'ready' && current.state === 'disabled') {
        throw new ExecutionTargetServiceError(
          ExecutionTargetErrors.codes.EXECUTION_TARGET_INVALID_STATE,
          `disabled execution target cannot become ready: ${id}`,
          { id, state: current.state },
        );
      }
      const target = executionTargetSchema.parse({ ...current, state, updated_at: nowIsoDateTime() });
      await this.replace(
        this.targets.map((candidate) => (candidate.id === id ? target : candidate)),
        this.leases,
        { ...this.requests, [command.request_id]: id },
      );
      await this.events.append({
        event_type: state === 'disabled' ? 'execution_target.state_changed' : 'execution_target.updated',
        entity_type: 'execution_target',
        entity_id: id,
        request_id: command.request_id,
        actor: 'user',
        state,
      });
      this.changes.fire({ target, kind: state === 'ready' ? 'ready' : 'disabled' });
      return target;
    });
  }

  private require(id: string): ExecutionTarget {
    const target = this.targets.find((candidate) => candidate.id === id);
    if (target === undefined) {
      throw new ExecutionTargetServiceError(
        ExecutionTargetErrors.codes.EXECUTION_TARGET_NOT_FOUND,
        `execution target not found: ${id}`,
        { id },
      );
    }
    return target;
  }

  private requireLease(id: string): ExecutionLease {
    const lease = this.leases.find((candidate) => candidate.id === id);
    if (lease === undefined) {
      throw new ExecutionTargetServiceError(
        ExecutionTargetErrors.codes.EXECUTION_TARGET_LEASE_NOT_FOUND,
        `execution lease not found: ${id}`,
        { id },
      );
    }
    return lease;
  }

  private async load(): Promise<void> {
    const raw = await this.store.get<unknown>(this.scope, TARGET_KEY);
    if (raw === undefined) {
      await this.replace([], [], {});
      return;
    }
    const document = documentSchema.parse(raw);
    this.targets = document.targets;
    this.leases = document.leases;
    this.requests = document.requests;
  }

  private async replace(
    targets: readonly ExecutionTarget[],
    leases: readonly ExecutionLease[],
    requests: Record<string, string>,
  ): Promise<void> {
    const document: TargetDocument = {
      version: DOCUMENT_VERSION,
      targets: [...targets],
      leases: [...leases],
      requests,
    };
    await this.store.set(this.scope, TARGET_KEY, document);
    this.targets = document.targets;
    this.leases = document.leases;
    this.requests = document.requests;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(work, work);
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

function assertCredentialReference(value: string | undefined): void {
  if (value !== undefined && !/^secret_[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new ExecutionTargetServiceError(
      ExecutionTargetErrors.codes.EXECUTION_TARGET_CREDENTIAL_INVALID,
      'execution target credentials must be an opaque reference',
    );
  }
}

function assertSafeMetadata(metadata: Readonly<Record<string, unknown>> | undefined): void {
  const path = findSensitivePlatformMetadataPath(metadata);
  if (path !== undefined) {
    throw new ExecutionTargetServiceError(
      ExecutionTargetErrors.codes.EXECUTION_TARGET_CREDENTIAL_INVALID,
      `execution target metadata cannot contain secret material in '${path}'`,
      { key: path },
    );
  }
}

registerScopedService(
  LifecycleScope.Workspace,
  IWorkspaceExecutionTargetService,
  WorkspaceExecutionTargetService,
  ScopeActivation.OnScopeCreated,
  'executionTargets',
);
