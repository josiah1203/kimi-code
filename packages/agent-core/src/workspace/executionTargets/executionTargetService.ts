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
  executionTargetTestInputSchema,
  executionTargetTestResultSchema,
  executionTargetUpdateInputSchema,
  nowIsoDateTime,
  type ExecutionLease,
  type ExecutionLeaseAcquireInput,
  type ExecutionLeaseReleaseInput,
  type ExecutionTarget,
  type ExecutionTargetCommandInput,
  type ExecutionTargetCreateInput,
  type ExecutionTargetTestInput,
  type ExecutionTargetTestResult,
  type ExecutionTargetUpdateInput,
} from '@spiderbyte/protocol';

import {
  IWorkspaceExecutionTargetService,
  type WorkspaceExecutionTargetsChangedEvent,
} from './executionTarget';
import { ExecutionTargetErrors, ExecutionTargetServiceError } from './errors';
import { findSensitivePlatformMetadataPath } from '#/workspace/platformServices/metadata';
import {
  IWorkspaceSshDaemonService,
  validateSshTargetConfiguration,
} from '#/workspace/execution/sshDaemon';
import {
  resolveExecutionEndpoint,
  isLoopbackOrLinkLocalHost,
  isPrivateNetworkHost,
} from '#/workspace/execution/endpointSecurity';
import { readResponseTextBounded } from '#/app/net/responseBody';

const TARGET_KEY = 'execution-targets.json';
const DOCUMENT_VERSION = 1;
const MAX_HEALTH_RESPONSE_BYTES = 64 * 1024;
const SUPPORTED_REMOTE_TARGET_TYPES = new Set<ExecutionTarget['type']>([
  'customer-managed',
  'private-gateway',
  'ssh',
]);

const documentSchema = z.strictObject({
  version: z.literal(DOCUMENT_VERSION),
  targets: z.array(executionTargetSchema),
  leases: z.array(executionLeaseSchema),
  requests: z.record(z.string(), z.string()).default({}),
  test_requests: z.record(z.string(), executionTargetTestResultSchema).default({}),
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
  private testRequests: Record<string, ExecutionTargetTestResult> = {};
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    @IAtomicDocumentStore private readonly store: IAtomicDocumentStore,
    @IWorkspaceContext private readonly context: IWorkspaceContext,
    @IWorkspacePolicyService private readonly policy: IWorkspacePolicyService,
    @IWorkspacePlatformEventService private readonly events: IWorkspacePlatformEventService,
    @IWorkspaceSshDaemonService private readonly sshDaemon: IWorkspaceSshDaemonService,
  ) {
    super();
    this.scope = `${context.persistenceScope}/platform`;
    this.onDidChange = this.changes.event;
    this.ready = this.load();
  }

  async list(): Promise<readonly ExecutionTarget[]> {
    return this.enqueue(async () => {
      await this.ready;
      await this.expireElapsedLeases(new Date());
      return [...this.targets];
    });
  }

  async get(id: string): Promise<ExecutionTarget | undefined> {
    return this.enqueue(async () => {
      await this.ready;
      await this.expireElapsedLeases(new Date());
      return this.targets.find((target) => target.id === id);
    });
  }

  async register(input: ExecutionTargetCreateInput): Promise<ExecutionTarget> {
    const command = executionTargetCreateInputSchema.parse(input);
    assertCredentialReference(command.credential_ref);
    assertEndpoint(command.type, command.endpoint);
    assertSafeMetadata(command.metadata);
    assertTargetConfiguration(command.type, command.endpoint, command.ssh, command.authentication_method, command.credential_ref);
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
        available_models: command.available_models ?? [],
        available_providers: command.available_providers ?? [],
        authentication_method: command.authentication_method
          ?? (command.type === 'ssh'
            ? command.credential_ref === undefined ? 'ssh_agent' : 'ssh_key'
            : command.credential_ref === undefined ? 'none' : 'secret_ref'),
        policy: command.policy ?? {
          approval_required: command.type !== 'local',
          allowed_operations: [],
        },
        health_status: 'unknown',
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
      assertEndpoint(current.type, command.endpoint);
      assertTargetConfiguration(
        current.type,
        command.endpoint ?? current.endpoint,
        command.ssh ?? current.ssh,
        command.authentication_method ?? current.authentication_method,
        command.credential_ref ?? current.credential_ref,
      );
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.require(mapped);
      const { request_id: _requestId, ...patch } = command;
      const target = executionTargetSchema.parse({ ...current, ...patch, updated_at: nowIsoDateTime() });
      if (target.state === 'ready') assertTargetReady(target);
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

  async revoke(id: string, input: ExecutionTargetCommandInput): Promise<ExecutionTarget | undefined> {
    return this.setState(id, executionTargetCommandInputSchema.parse(input), 'disabled', 'revoked');
  }

  async test(id: string, input: ExecutionTargetTestInput): Promise<ExecutionTargetTestResult> {
    const command = executionTargetTestInputSchema.parse(input);
    await this.ready;
    const cached = this.testRequests[command.request_id];
    if (cached !== undefined) {
      if (cached.target_id !== id) {
        throw new ExecutionTargetServiceError(
          ExecutionTargetErrors.codes.EXECUTION_TARGET_REQUEST_REUSED,
          'execution target test request id was already used for another target',
          { requestId: command.request_id, targetId: id },
        );
      }
      return cached;
    }
    const target = this.require(id);
    const result = await probeExecutionTarget(
      target,
      command.request_id,
      command.timeout_ms,
      this.context.workspaceId,
      this.sshDaemon,
    );
    return this.enqueue(async () => {
      await this.ready;
      const existing = this.testRequests[command.request_id];
      if (existing !== undefined) {
        if (existing.target_id !== id) {
          throw new ExecutionTargetServiceError(
            ExecutionTargetErrors.codes.EXECUTION_TARGET_REQUEST_REUSED,
            'execution target test request id was already used for another target',
            { requestId: command.request_id, targetId: id },
          );
        }
        return existing;
      }
      const current = this.require(id);
      const nextTarget = executionTargetSchema.parse({
        ...current,
        health_status: result.status,
        last_health_check_at: result.checked_at,
        capabilities: result.capabilities ?? current.capabilities,
        available_models: result.available_models ?? current.available_models,
        available_providers: result.available_providers ?? current.available_providers,
        resources: result.resources ?? current.resources,
        version_compatibility: result.version_compatibility ?? current.version_compatibility,
        state: isTargetValidated({
          ...current,
          health_status: result.status,
          version_compatibility: result.version_compatibility ?? current.version_compatibility,
        }) || current.state !== 'ready' ? current.state : 'draining',
        updated_at: result.checked_at,
      });
      await this.replace(
        this.targets.map((candidate) => (candidate.id === id ? nextTarget : candidate)),
        this.leases,
        this.requests,
        { ...this.testRequests, [command.request_id]: result },
      );
      await this.events.append({
        event_type: 'execution_target.validated',
        entity_type: 'execution_target',
        entity_id: id,
        request_id: command.request_id,
        actor: 'user',
        state: nextTarget.state,
        payload: {
          health_status: result.status,
          target_state: nextTarget.state,
          capabilities: result.capabilities,
          version_compatibility: result.version_compatibility,
        },
      });
      this.changes.fire({ target: nextTarget, kind: 'health_changed' });
      return result;
    });
  }

  async getLease(targetId: string, leaseId: string): Promise<ExecutionLease | undefined> {
    return this.enqueue(async () => {
      await this.ready;
      await this.expireElapsedLeases(new Date());
      return this.leases.find((lease) => lease.id === leaseId && lease.target_id === targetId);
    });
  }

  async acquireLease(id: string, input: ExecutionLeaseAcquireInput): Promise<ExecutionLease> {
    const command = executionLeaseAcquireInputSchema.parse(input);
    return this.enqueue(async () => {
      await this.ready;
      await this.expireElapsedLeases(new Date());
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
      assertTargetReady(target);
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
      await this.expireElapsedLeases(new Date());
      const lease = this.leases.find((candidate) => candidate.id === leaseId && candidate.target_id === id);
      if (lease === undefined) return undefined;
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.requireLease(mapped);
      if (lease.state === 'released' || lease.state === 'expired') return lease;
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
    eventKind: 'ready' | 'disabled' | 'revoked' = state === 'disabled' ? 'disabled' : 'ready',
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
      if (state === 'ready') assertTargetReady(current);
      const target = executionTargetSchema.parse({ ...current, state, updated_at: nowIsoDateTime() });
      const revokedLeaseIds = eventKind === 'revoked'
        ? this.leases
          .filter((lease) => lease.target_id === id && lease.state !== 'released')
          .map((lease) => lease.id)
        : [];
      const revokedLeases = eventKind === 'revoked'
        ? this.leases.map((lease) => lease.target_id !== id || lease.state === 'released'
          ? lease
          : executionLeaseSchema.parse({ ...lease, state: 'released', released_at: target.updated_at }))
        : this.leases;
      const nextTarget = eventKind === 'revoked'
        ? executionTargetSchema.parse({ ...target, lease_ref: undefined })
        : target;
      await this.replace(
        this.targets.map((candidate) => (candidate.id === id ? nextTarget : candidate)),
        revokedLeases,
        { ...this.requests, [command.request_id]: id },
      );
      await this.events.append({
        event_type: eventKind === 'revoked'
          ? 'execution_target.revoked'
          : state === 'disabled' ? 'execution_target.state_changed' : 'execution_target.updated',
        entity_type: 'execution_target',
        entity_id: id,
        request_id: command.request_id,
        actor: 'user',
        state,
        payload: eventKind === 'revoked'
          ? { revoked_lease_ids: revokedLeaseIds }
          : undefined,
      });
      this.changes.fire({
        target: nextTarget,
        kind: eventKind === 'revoked' ? 'revoked' : state === 'ready' ? 'ready' : 'disabled',
      });
      return nextTarget;
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

  /**
   * Move elapsed leases out of the active/approval state before any read or
   * mutation observes them. Expiration is durable so restart, replay, and
   * late release requests cannot resurrect or detach a newer lease.
   */
  private async expireElapsedLeases(now: Date): Promise<void> {
    const elapsed = this.leases.filter(
      (lease) =>
        (lease.state === 'active' || lease.state === 'awaiting_approval') &&
        new Date(lease.expires_at).getTime() <= now.getTime(),
    );
    if (elapsed.length === 0) return;

    const elapsedIds = new Set(elapsed.map((lease) => lease.id));
    const expiredAt = now.toISOString();
    const nextLeases = this.leases.map((lease) =>
      elapsedIds.has(lease.id)
        ? executionLeaseSchema.parse({ ...lease, state: 'expired' })
        : lease,
    );
    const nextTargets = this.targets.map((target) => {
      const lease = this.leases.find((candidate) => candidate.lease_ref === target.lease_ref);
      if (lease === undefined || !elapsedIds.has(lease.id)) return target;
      return executionTargetSchema.parse({
        ...target,
        lease_ref: undefined,
        updated_at: expiredAt,
      });
    });
    await this.replace(nextTargets, nextLeases, this.requests);
    for (const lease of elapsed) {
      await this.events.append({
        event_type: 'execution_target.lease_expired',
        entity_type: 'execution_target',
        entity_id: lease.target_id,
        actor: 'system',
        state: 'expired',
        payload: {
          lease_id: lease.id,
          expired_at: expiredAt,
        },
      });
      const target = this.targets.find((candidate) => candidate.id === lease.target_id);
      const expiredLease = nextLeases.find((candidate) => candidate.id === lease.id);
      if (target !== undefined) this.changes.fire({ target, kind: 'lease_changed', lease: expiredLease });
    }
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
    this.testRequests = document.test_requests;
  }

  private async replace(
    targets: readonly ExecutionTarget[],
    leases: readonly ExecutionLease[],
    requests: Record<string, string>,
    testRequests: Record<string, ExecutionTargetTestResult> = this.testRequests,
  ): Promise<void> {
    const document: TargetDocument = {
      version: DOCUMENT_VERSION,
      targets: [...targets],
      leases: [...leases],
      requests,
      test_requests: testRequests,
    };
    await this.store.set(this.scope, TARGET_KEY, document);
    this.targets = document.targets;
    this.leases = document.leases;
    this.requests = document.requests;
    this.testRequests = document.test_requests;
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

function assertTargetReady(target: ExecutionTarget): void {
  if (!isTargetValidated(target)) {
    const version = target.version_compatibility;
    if (target.health_status === 'healthy'
      && version?.required_protocol_version !== undefined
      && version.compatible !== true) {
      throw new ExecutionTargetServiceError(
        ExecutionTargetErrors.codes.EXECUTION_TARGET_NOT_VALIDATED,
        `execution target protocol is not compatible: ${target.id}`,
        {
          id: target.id,
          required_protocol_version: version.required_protocol_version,
          observed_protocol_version: version.observed_protocol_version,
        },
      );
    }
    throw new ExecutionTargetServiceError(
      ExecutionTargetErrors.codes.EXECUTION_TARGET_NOT_VALIDATED,
      `execution target has not passed a health check: ${target.id}`,
      { id: target.id, health_status: target.health_status ?? 'unknown' },
    );
  }
}

function isTargetValidated(target: Pick<ExecutionTarget, 'health_status' | 'version_compatibility'>): boolean {
  return target.health_status === 'healthy'
    && (target.version_compatibility?.required_protocol_version === undefined
      || target.version_compatibility.compatible === true);
}

function assertEndpoint(
  type: ExecutionTarget['type'] | undefined,
  value: string | undefined,
): void {
  if (value === undefined) return;
  if (/[\s\u0000-\u001F\u007F]/.test(value)) {
    throw new ExecutionTargetServiceError(
      ExecutionTargetErrors.codes.EXECUTION_TARGET_ENDPOINT_INVALID,
      'execution target endpoint contains invalid control characters',
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ExecutionTargetServiceError(
      ExecutionTargetErrors.codes.EXECUTION_TARGET_ENDPOINT_INVALID,
      'execution target endpoint must be a valid URL',
    );
  }
  if (url.username !== '' || url.password !== '') {
    throw new ExecutionTargetServiceError(
      ExecutionTargetErrors.codes.EXECUTION_TARGET_ENDPOINT_INVALID,
      'execution target endpoint must not contain embedded credentials',
    );
  }
  if (type === 'customer-managed' && isPrivateNetworkHost(url.hostname)) {
    throw new ExecutionTargetServiceError(
      ExecutionTargetErrors.codes.EXECUTION_TARGET_ENDPOINT_INVALID,
      'customer-managed execution target endpoints must not use private network addresses',
    );
  }
  if (type === 'private-gateway' && isLoopbackOrLinkLocalHost(url.hostname)) {
    throw new ExecutionTargetServiceError(
      ExecutionTargetErrors.codes.EXECUTION_TARGET_ENDPOINT_INVALID,
      'private-gateway endpoints must not use loopback or link-local addresses',
    );
  }
  for (const key of url.searchParams.keys()) {
    if (/(?:token|secret|password|api[_-]?key|authorization|credential)/i.test(key)) {
      throw new ExecutionTargetServiceError(
        ExecutionTargetErrors.codes.EXECUTION_TARGET_ENDPOINT_INVALID,
        'execution target endpoint must not contain credential query parameters',
      );
    }
  }
  const allowedProtocols: Record<ExecutionTarget['type'], readonly string[]> = {
    local: ['http:', 'https:'],
    ssh: ['ssh:'],
    docker: ['docker:'],
    kubernetes: ['kubernetes:', 'https:'],
    'customer-managed': ['http:', 'https:'],
    'private-gateway': ['http:', 'https:'],
  };
  if (type !== undefined && !allowedProtocols[type].includes(url.protocol)) {
    throw new ExecutionTargetServiceError(
      ExecutionTargetErrors.codes.EXECUTION_TARGET_ENDPOINT_INVALID,
      `endpoint protocol '${url.protocol}' is not valid for ${type} execution targets`,
      { type, protocol: url.protocol },
    );
  }
}

async function probeExecutionTarget(
  target: ExecutionTarget,
  requestId: string,
  timeoutMs: number,
  workspaceId: string,
  sshDaemon: IWorkspaceSshDaemonService,
): Promise<ExecutionTargetTestResult> {
  const checkedAt = nowIsoDateTime();
  if (target.state === 'disabled') {
    return executionTargetTestResultSchema.parse({
      target_id: target.id,
      workspace_id: target.workspace_id,
      status: 'unavailable',
      checked_at: checkedAt,
      message: 'execution target is revoked or disabled',
    });
  }
  if (target.type === 'local') {
    return executionTargetTestResultSchema.parse({
      target_id: target.id,
      workspace_id: target.workspace_id,
      status: 'healthy',
      checked_at: checkedAt,
      message: 'local execution target is available to the current process',
      capabilities: target.capabilities,
      available_models: target.available_models,
      available_providers: target.available_providers,
      resources: target.resources,
      version_compatibility: target.version_compatibility,
    });
  }
  if (target.type === 'ssh') {
    return sshDaemon.probe(target, workspaceId, {
      requestId: requestId,
      timeoutMs,
    });
  }
  if (!SUPPORTED_REMOTE_TARGET_TYPES.has(target.type)) {
    return executionTargetTestResultSchema.parse({
      target_id: target.id,
      workspace_id: target.workspace_id,
      status: 'adapter-dependent',
      checked_at: checkedAt,
      message: `${target.type} execution transport adapter is not configured`,
    });
  }

  const endpoint = target.endpoint ?? target.metadata?.['worker_endpoint'];
  if (typeof endpoint !== 'string' || endpoint.trim().length === 0) {
    return executionTargetTestResultSchema.parse({
      target_id: target.id,
      workspace_id: target.workspace_id,
      status: 'unavailable',
      checked_at: checkedAt,
      message: 'execution target does not define a health endpoint',
    });
  }
  try {
    assertEndpoint(target.type, endpoint);
  } catch (error) {
    return executionTargetTestResultSchema.parse({
      target_id: target.id,
      workspace_id: target.workspace_id,
      status: 'unavailable',
      checked_at: checkedAt,
      message: error instanceof ExecutionTargetServiceError ? error.message : 'execution target endpoint is invalid',
    });
  }

  let resolvedEndpoint: Awaited<ReturnType<typeof resolveExecutionEndpoint>>;
  try {
    resolvedEndpoint = await resolveExecutionEndpoint(endpoint, target.type as 'customer-managed' | 'private-gateway');
  } catch (error) {
    return executionTargetTestResultSchema.parse({
      target_id: target.id,
      workspace_id: target.workspace_id,
      status: 'unavailable',
      checked_at: checkedAt,
      message: error instanceof Error ? error.message : 'execution target endpoint could not be validated',
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(healthEndpoint(resolvedEndpoint.url), {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
      dispatcher: resolvedEndpoint.dispatcher,
    } as RequestInit & { readonly dispatcher?: import('undici').Dispatcher });
    const text = await readResponseTextBounded(response, MAX_HEALTH_RESPONSE_BYTES);
    if (text === undefined) {
      return executionTargetTestResultSchema.parse({
        target_id: target.id,
        workspace_id: target.workspace_id,
        status: 'unhealthy',
        checked_at: checkedAt,
        message: 'execution target health response is too large',
      });
    }
    if (!response.ok) {
      return executionTargetTestResultSchema.parse({
        target_id: target.id,
        workspace_id: target.workspace_id,
        status: 'unhealthy',
        checked_at: checkedAt,
        message: `execution target health check returned HTTP ${response.status}`,
      });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return executionTargetTestResultSchema.parse({
        target_id: target.id,
        workspace_id: target.workspace_id,
        status: 'unhealthy',
        checked_at: checkedAt,
        message: 'execution target health response was not valid JSON',
      });
    }
    return parseHealthResponse(target, checkedAt, payload);
  } catch {
    return executionTargetTestResultSchema.parse({
      target_id: target.id,
      workspace_id: target.workspace_id,
      status: 'unavailable',
      checked_at: checkedAt,
      message: controller.signal.aborted
        ? 'execution target health check timed out'
        : 'execution target health check failed',
    });
  } finally {
    clearTimeout(timer);
    await resolvedEndpoint.dispatcher?.close().catch(() => undefined);
  }
}

function parseHealthResponse(
  target: ExecutionTarget,
  checkedAt: string,
  payload: unknown,
): ExecutionTargetTestResult {
  const value = payload !== null && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : {};
  const capabilities = stringArray(value['capabilities']);
  const availableModels = stringArray(value['available_models'] ?? value['models']);
  const availableProviders = stringArray(value['available_providers'] ?? value['providers']);
  const resources = executionTargetResourceInfoFromUnknown(value['resources']);
  const protocolVersion = positiveInteger(value['protocol_version']);
  const versionCompatibility = protocolVersion === undefined
    ? target.version_compatibility
    : {
      ...target.version_compatibility,
      observed_protocol_version: protocolVersion,
      compatible: target.version_compatibility?.required_protocol_version === undefined
        ? target.version_compatibility?.compatible
        : protocolVersion === target.version_compatibility.required_protocol_version,
      message: target.version_compatibility?.required_protocol_version === undefined
        ? target.version_compatibility?.message
        : protocolVersion === target.version_compatibility.required_protocol_version
          ? 'protocol version is compatible'
          : `expected protocol version ${target.version_compatibility.required_protocol_version}`,
    };
  const compatible = versionCompatibility?.compatible;
  const remoteStatus = value['status'];
  const status = compatible === false
    ? 'unhealthy'
    : remoteStatus === 'ready' || remoteStatus === 'healthy' || remoteStatus === undefined
      ? 'healthy'
      : 'unhealthy';
  return executionTargetTestResultSchema.parse({
    target_id: target.id,
    workspace_id: target.workspace_id,
    status,
    checked_at: checkedAt,
    message: compatible === false ? versionCompatibility?.message : 'execution target health check passed',
    capabilities,
    available_models: availableModels,
    available_providers: availableProviders,
    resources,
    version_compatibility: versionCompatibility,
  });
}

function healthEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.pathname.endsWith('/v1/execute')) {
    url.pathname = '/health';
  } else {
    const base = url.pathname.replace(/\/$/, '');
    url.pathname = `${base}/health`;
  }
  url.search = '';
  url.hash = '';
  return url.toString();
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return values.length === value.length ? values : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function executionTargetResourceInfoFromUnknown(value: unknown): {
  readonly cpu_cores?: number;
  readonly memory_bytes?: number;
  readonly gpu_count?: number;
  readonly gpu_models?: readonly string[];
} | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const resource = value as Record<string, unknown>;
  const cpuCores = typeof resource['cpu_cores'] === 'number' && Number.isFinite(resource['cpu_cores']) && resource['cpu_cores'] >= 0
    ? resource['cpu_cores']
    : undefined;
  const memoryBytes = typeof resource['memory_bytes'] === 'number' && Number.isInteger(resource['memory_bytes']) && resource['memory_bytes'] >= 0
    ? resource['memory_bytes']
    : undefined;
  const gpuCount = typeof resource['gpu_count'] === 'number' && Number.isInteger(resource['gpu_count']) && resource['gpu_count'] >= 0
    ? resource['gpu_count']
    : undefined;
  const gpuModels = stringArray(resource['gpu_models']);
  if (cpuCores === undefined && memoryBytes === undefined && gpuCount === undefined && gpuModels === undefined) {
    return undefined;
  }
  return { cpu_cores: cpuCores, memory_bytes: memoryBytes, gpu_count: gpuCount, gpu_models: gpuModels };
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

function assertTargetConfiguration(
  type: ExecutionTarget['type'],
  endpoint: string | undefined,
  ssh: unknown,
  authenticationMethod: ExecutionTarget['authentication_method'],
  credentialRef: string | undefined,
): void {
  if (type !== 'ssh') return;
  try {
    validateSshTargetConfiguration({
      endpoint,
      ssh,
      authenticationMethod,
      credentialRef,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SSH target configuration is invalid';
    const credentialFailure = /credential|authentication/i.test(message);
    throw new ExecutionTargetServiceError(
      credentialFailure
        ? ExecutionTargetErrors.codes.EXECUTION_TARGET_CREDENTIAL_INVALID
        : ExecutionTargetErrors.codes.EXECUTION_TARGET_ENDPOINT_INVALID,
      message,
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
