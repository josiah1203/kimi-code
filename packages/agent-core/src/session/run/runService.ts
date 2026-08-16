/**
 * `run` domain — session-scoped durable Run lifecycle.
 *
 * The service owns only the platform Run document. It serializes mutations in
 * process and replaces the document through `IAtomicDocumentStore`, leaving
 * agent turns, prompt execution, and replayable wire history to their existing
 * authorities. Bound at Session scope.
 */

import { ulid } from 'ulid';
import { z } from 'zod';

import { Disposable } from '#/_base/di/lifecycle';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { Emitter, type Event } from '#/_base/event';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { ISessionContext } from '#/session/sessionContext/sessionContext';
import { IWorkspacePlatformEventService } from '#/workspace/platformEvents/platformEvents';
import { Error2, ErrorCodes } from '#/errors';
import { findSensitivePlatformMetadataPath } from '#/workspace/platformServices/metadata';
import {
  attemptActionInputSchema,
  attemptCreateInputSchema,
  attemptSchema,
  attemptTransitionInputSchema,
  nowIsoDateTime,
  runActionInputSchema,
  runCreateInputSchema,
  runForkInputSchema,
  runSchema,
  runTransitionInputSchema,
  type Run,
  type Attempt,
  type AttemptActionInput,
  type AttemptCreateInput,
  type AttemptStatus,
  type AttemptTransitionInput,
  type RunActionInput,
  type RunCreateInput,
  type RunForkInput,
  type RunStatus,
  type RunTransitionInput,
} from '@spiderbyte/protocol';

import { AttemptStateError, ISessionRunService, RunStateError } from './run';

const RUNS_KEY = 'runs.json';
const RUNS_DOCUMENT_VERSION = 2;

const runsDocumentSchema = z.strictObject({
  version: z.literal(RUNS_DOCUMENT_VERSION),
  runs: z.array(runSchema),
  attempts: z.array(attemptSchema).default([]),
  requests: z.record(z.string(), z.string()).default({}),
  attempt_requests: z.record(z.string(), z.string()).default({}),
});

const legacyRunsDocumentSchema = z.strictObject({
  version: z.literal(1),
  runs: z.array(runSchema),
  requests: z.record(z.string(), z.string()).default({}),
});

const allowedTransitions: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  queued: ['planning', 'running', 'failed', 'cancelled'],
  planning: ['awaiting_approval', 'running', 'failed', 'cancelled'],
  awaiting_approval: ['running', 'failed', 'cancelled'],
  // A platform service can discover an approval gate after it has started
  // resolving inputs (for example, a dataset or execution-target policy).
  // Preserve that durable state instead of leaving the Run stuck in
  // `running` when the tool projects the gate into the transcript.
  running: ['succeeded', 'failed', 'cancelled', 'awaiting_approval'],
  succeeded: [],
  failed: [],
  cancelled: [],
};

const terminalStatuses = new Set<RunStatus>(['succeeded', 'failed', 'cancelled']);

const allowedAttemptTransitions: Readonly<Record<AttemptStatus, readonly AttemptStatus[]>> = {
  queued: ['planning', 'awaiting_approval', 'running', 'succeeded', 'failed', 'cancelled', 'partial', 'recovered'],
  planning: ['awaiting_approval', 'running', 'succeeded', 'failed', 'cancelled', 'partial', 'recovered'],
  awaiting_approval: ['running', 'failed', 'cancelled'],
  running: ['succeeded', 'failed', 'cancelled', 'partial', 'awaiting_approval'],
  succeeded: [],
  failed: [],
  cancelled: [],
  partial: [],
  recovered: ['queued', 'running', 'cancelled'],
};

const terminalAttemptStatuses = new Set<AttemptStatus>([
  'succeeded',
  'failed',
  'cancelled',
  'partial',
  'recovered',
]);

export class SessionRunService extends Disposable implements ISessionRunService {
  declare readonly _serviceBrand: undefined;

  readonly onDidChange: Event<Run>;
  readonly onDidChangeAttempt: Event<Attempt>;
  readonly ready: Promise<void>;

  private readonly changes = this._register(new Emitter<Run>());
  private readonly attemptChanges = this._register(new Emitter<Attempt>());
  private readonly scope: string;
  private runs: readonly Run[] = [];
  private attempts: readonly Attempt[] = [];
  private requests: Record<string, string> = {};
  private attemptRequests: Record<string, string> = {};
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    @IAtomicDocumentStore private readonly store: IAtomicDocumentStore,
    @ISessionContext private readonly context: ISessionContext,
    @IWorkspacePlatformEventService private readonly events: IWorkspacePlatformEventService,
  ) {
    super();
    this.scope = context.scope('platform');
    this.onDidChange = this.changes.event;
    this.onDidChangeAttempt = this.attemptChanges.event;
    this.ready = this.load();
  }

  async list(): Promise<readonly Run[]> {
    await this.ready;
    return [...this.runs];
  }

  async drain(): Promise<void> {
    await this.ready;
    await this.mutationQueue;
  }

  async get(id: string): Promise<Run | undefined> {
    await this.ready;
    return this.runs.find((run) => run.id === id);
  }

  async listAttempts(runId?: string): Promise<readonly Attempt[]> {
    await this.ready;
    return this.attempts.filter((attempt) => runId === undefined || attempt.run_id === runId);
  }

  async getAttempt(id: string): Promise<Attempt | undefined> {
    await this.ready;
    return this.attempts.find((attempt) => attempt.id === id);
  }

  async createAttempt(runId: string, input: AttemptCreateInput): Promise<Attempt | undefined> {
    const command = attemptCreateInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const existingId = this.attemptRequests[command.request_id];
      if (existingId !== undefined) return this.requireAttempt(existingId);
      const run = this.runs.find((candidate) => candidate.id === runId);
      if (run === undefined) return undefined;
      const previous = run.active_attempt_id === undefined
        ? undefined
        : this.attempts.find((attempt) => attempt.id === run.active_attempt_id);
      if (command.kind === 'initial' && previous !== undefined) {
        throw new Error2(
          ErrorCodes.REQUEST_INVALID,
          `initial Attempt already exists for Run: ${run.id}`,
          { details: { runId: run.id, attemptId: previous.id } },
        );
      }
      if (run.status === 'succeeded') {
        throw new Error2(
          ErrorCodes.REQUEST_INVALID,
          `cannot create another Attempt for succeeded Run: ${run.id}`,
          { details: { runId: run.id } },
        );
      }
      if (command.parent_attempt_id !== undefined) {
        const parent = this.attempts.find((attempt) => attempt.id === command.parent_attempt_id);
        if (parent === undefined || parent.run_id !== run.id) {
          throw new Error2(
            ErrorCodes.REQUEST_INVALID,
            `parent Attempt not found in Run: ${command.parent_attempt_id}`,
            { details: { runId: run.id, attemptId: command.parent_attempt_id } },
          );
        }
      }
      if (command.retry_of_attempt_id !== undefined) {
        const retryOf = this.attempts.find((attempt) => attempt.id === command.retry_of_attempt_id);
        if (retryOf === undefined || retryOf.run_id !== run.id || !terminalAttemptStatuses.has(retryOf.status)) {
          throw new Error2(
            ErrorCodes.REQUEST_INVALID,
            `retry source Attempt is unavailable: ${command.retry_of_attempt_id}`,
            { details: { runId: run.id, attemptId: command.retry_of_attempt_id } },
          );
        }
      }
      if (run.status !== 'running' && command.kind === 'recovery' && previous !== undefined && previous.status !== 'recovered') {
        throw new Error2(
          ErrorCodes.REQUEST_INVALID,
          `recovery Attempt requires a Run with an interrupted Attempt: ${run.id}`,
          { details: { runId: run.id, status: run.status, attemptStatus: previous.status } },
        );
      }

      const attempt = this.materializeAttempt(run, command);
      const now = nowIsoDateTime();
      // A succeeded Run is rejected above; any terminal status that reaches
      // this point is therefore retryable.
      const reopened = terminalStatuses.has(run.status);
      const {
        completed_at: _completedAt,
        started_at: _startedAt,
        partial_result: _partialResult,
        ...withoutCompletedAt
      } = run;
      const attached = attachAttempt(
        reopened ? withoutCompletedAt as Run : run,
        attempt,
      );
      const nextRun = runSchema.parse({
        ...attached,
        status: reopened ? 'queued' : run.status,
        updated_at: now,
        status_reason: reopened ? 'retry_requested' : run.status_reason,
      });
      await this.replace(
        this.runs.map((candidate) => (candidate.id === run.id ? nextRun : candidate)),
        [...this.attempts, attempt],
        this.requests,
        { ...this.attemptRequests, [command.request_id]: attempt.id },
      );
      await this.emitAttemptEvent(attempt, command.request_id, 'created');
      if (reopened) {
        await this.events.append({
          event_type: 'run.updated',
          entity_type: 'run',
          entity_id: nextRun.id,
          request_id: command.request_id,
          actor: 'agent',
          state: nextRun.status,
          payload: { agent_session_id: nextRun.agent_session_id, attempt_id: attempt.id, reason: 'retry_requested' },
        });
        this.changes.fire(nextRun);
      }
      this.attemptChanges.fire(attempt);
      return attempt;
    });
  }

  async transitionAttempt(id: string, input: AttemptTransitionInput): Promise<Attempt | undefined> {
    const command = attemptTransitionInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const mapped = this.attemptRequests[command.request_id];
      if (mapped !== undefined) return this.requireAttempt(mapped);
      const current = this.attempts.find((attempt) => attempt.id === id);
      if (current === undefined) return undefined;
      const run = this.require(current.run_id);
      if (run.active_attempt_id !== current.id) {
        throw new Error2(
          ErrorCodes.REQUEST_INVALID,
          `only the active Attempt can transition: ${current.id}`,
          { details: { runId: run.id, attemptId: current.id, activeAttemptId: run.active_attempt_id } },
        );
      }
      const sameStatus = current.status === command.status;
      if (!sameStatus && !allowedAttemptTransitions[current.status].includes(command.status)) {
        throw new AttemptStateError(id, current.status, command.status);
      }
      const now = nowIsoDateTime();
      const next = this.patchAttemptForRun(current, command.status, now, command);
      const projectedStatus = runStatusForAttempt(run, next);
      if (next.status === 'succeeded') {
        const requiredChild = findIncompleteRequiredChild(this.runs, run.id);
        if (requiredChild !== undefined && !terminalStatuses.has(requiredChild.status)) {
          throw new Error2(
            ErrorCodes.REQUEST_INVALID,
            `Run cannot succeed while required child Run ${requiredChild.id} is ${requiredChild.status}`,
            {
              details: {
                runId: run.id,
                childRunId: requiredChild.id,
                childStatus: requiredChild.status,
              },
            },
          );
        }
      }
      if (projectedStatus !== run.status && !allowedTransitions[run.status].includes(projectedStatus)) {
        throw new RunStateError(run.id, run.status, projectedStatus);
      }
      const nextRun = runForAttempt(run, next, now);
      await this.replace(
        this.runs.map((candidate) => (candidate.id === nextRun.id ? nextRun : candidate)),
        this.attempts.map((attempt) => (attempt.id === id ? next : attempt)),
        this.requests,
        { ...this.attemptRequests, [command.request_id]: id },
      );
      await this.emitAttemptEvent(next, command.request_id, attemptEventType(next.status));
      if (nextRun.updated_at !== run.updated_at || nextRun.status !== run.status) {
        await this.events.append({
          event_type: runEventType(nextRun.status),
          entity_type: 'run',
          entity_id: nextRun.id,
          request_id: command.request_id,
          actor: 'agent',
          state: nextRun.status,
          payload: {
            agent_session_id: nextRun.agent_session_id,
            attempt_id: next.id,
            ...(next.output_artifacts === undefined ? {} : { output_artifacts: next.output_artifacts }),
          },
        });
        this.changes.fire(nextRun);
      }
      this.attemptChanges.fire(next);
      return next;
    });
  }

  async resumeAttempt(id: string, input: AttemptActionInput): Promise<Attempt | undefined> {
    const command = attemptActionInputSchema.parse(input);
    return this.transitionAttempt(id, {
      request_id: command.request_id,
      status: 'running',
      metadata: command.metadata,
    });
  }

  async cancelAttempt(id: string, input: AttemptActionInput): Promise<Attempt | undefined> {
    const command = attemptActionInputSchema.parse(input);
    return this.transitionAttempt(id, {
      request_id: command.request_id,
      status: 'cancelled',
      status_reason: 'cancelled_by_request',
      metadata: command.metadata,
    });
  }

  async retryAttempt(runId: string, input: AttemptActionInput): Promise<Attempt | undefined> {
    const command = attemptActionInputSchema.parse(input);
    await this.ready;
    const run = this.runs.find((candidate) => candidate.id === runId);
    if (run === undefined) return undefined;
    const source = run.active_attempt_id === undefined
      ? undefined
      : this.attempts.find((attempt) => attempt.id === run.active_attempt_id);
    return this.createAttempt(runId, {
      request_id: command.request_id,
      kind: 'retry',
      parent_attempt_id: source?.id,
      retry_of_attempt_id: source?.id,
      metadata: { ...command.metadata, retry_of_attempt_id: source?.id },
    });
  }

  async create(input: RunCreateInput): Promise<Run> {
    const command = runCreateInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const existingId = this.requests[command.request_id];
      if (existingId !== undefined) return this.require(existingId);
      const parentRun = command.parent_run_id === undefined
        ? undefined
        : this.runs.find((run) => run.id === command.parent_run_id);
      if (command.parent_run_id !== undefined && parentRun === undefined) {
        throw new Error2(
          ErrorCodes.REQUEST_INVALID,
          `parent run not found: ${command.parent_run_id}`,
          { details: { parentRunId: command.parent_run_id } },
        );
      }
      if (parentRun?.status === 'succeeded' && command.metadata?.['required'] === true) {
        throw new Error2(
          ErrorCodes.REQUEST_INVALID,
          `cannot attach a required child Run to succeeded parent: ${parentRun.id}`,
          { details: { parentRunId: parentRun.id } },
        );
      }

      const now = nowIsoDateTime();
      const baseRun = runSchema.parse({
        id: `run_${ulid()}`,
        workspace_id: this.context.workspaceId,
        agent_session_id: this.context.sessionId,
        status: 'queued',
        created_at: now,
        updated_at: now,
        ...command,
      });
      const attempt = this.materializeAttempt(baseRun, {
        request_id: `${command.request_id}:attempt`,
        kind: 'initial',
        project_id: command.project_id,
        execution_target_id: command.execution_target_id,
        policy_decision_ids: command.policy_decision_ids,
        approval_ids: command.approval_ids,
        user_id: command.user_id,
        provider: stringMetadata(command.metadata, 'provider'),
        model: stringMetadata(command.metadata, 'model'),
      });
      const run = attachAttempt(baseRun, attempt);
      await this.replace([...this.runs, run], [...this.attempts, attempt], {
        ...this.requests,
        [command.request_id]: run.id,
      }, {
        ...this.attemptRequests,
        [`${command.request_id}:attempt`]: attempt.id,
      });
      await this.events.append({
        event_type: 'run.created',
        entity_type: 'run',
        entity_id: run.id,
        request_id: command.request_id,
        actor: 'agent',
        state: run.status,
        payload: { agent_session_id: run.agent_session_id, attempt_id: attempt.id },
      });
      await this.emitAttemptEvent(attempt, command.request_id, 'created');
      this.changes.fire(run);
      this.attemptChanges.fire(attempt);
      return run;
    });
  }

  async transition(id: string, input: RunTransitionInput): Promise<Run | undefined> {
    const command = runTransitionInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const current = this.runs.find((run) => run.id === id);
      if (current === undefined) return undefined;
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.require(mapped);
      const requiredChild = command.status === 'succeeded'
        ? findIncompleteRequiredChild(this.runs, id)
        : undefined;
      if (requiredChild !== undefined && !terminalStatuses.has(requiredChild.status)) {
        throw new Error2(
          ErrorCodes.REQUEST_INVALID,
          `Run cannot succeed while required child Run ${requiredChild.id} is ${requiredChild.status}`,
          {
            details: {
              runId: id,
              childRunId: requiredChild.id,
              childStatus: requiredChild.status,
            },
          },
        );
      }
      const nextStatus: RunStatus = requiredChild === undefined ? command.status : 'failed';
      const statusReason = requiredChild === undefined
        ? command.status_reason
        : `required child Run ${requiredChild.id} ended with status ${requiredChild.status}`;
      const sameStatus = current.status === nextStatus;
      if (!sameStatus && !allowedTransitions[current.status].includes(nextStatus)) {
        throw new RunStateError(id, current.status, nextStatus);
      }

      const now = nowIsoDateTime();
      // Optional transition fields are patches, not replacements.  Tool
      // helpers normally update only the status, and dropping metadata or
      // artifact/target references at each phase would make the durable Run
      // unusable for replay and inspection.
      const patch: Partial<Run> = {};
      if (command.plan !== undefined) patch.plan = command.plan;
      if (command.input_resources !== undefined) patch.input_resources = command.input_resources;
      if (command.output_artifacts !== undefined) patch.output_artifacts = command.output_artifacts;
      if (command.policy_decision_ids !== undefined) patch.policy_decision_ids = command.policy_decision_ids;
      if (command.execution_target_id !== undefined) patch.execution_target_id = command.execution_target_id;
      if (command.metadata !== undefined) {
        patch.metadata = { ...current.metadata, ...command.metadata };
      }
      if (command.approval_ids !== undefined) patch.approval_ids = command.approval_ids;

      let nextAttempts = [...this.attempts];
      let nextAttempt = current.active_attempt_id === undefined
        ? undefined
        : this.attempts.find((attempt) => attempt.id === current.active_attempt_id);
      let nextAttemptRequestMap = this.attemptRequests;
      if (nextAttempt === undefined && nextStatus === 'running') {
        nextAttempt = this.materializeAttempt(current, {
          request_id: `${command.request_id}:recovery`,
          kind: 'recovery',
          metadata: { recovery_reason: 'run_has_no_active_attempt' },
        });
        nextAttempts.push(nextAttempt);
        nextAttemptRequestMap = {
          ...nextAttemptRequestMap,
          [`${command.request_id}:recovery`]: nextAttempt.id,
        };
      }
      const attemptStatus = attemptStatusForRunStatus(nextStatus, command.partial_artifacts);
      if (nextAttempt !== undefined && attemptStatus !== undefined) {
        nextAttempt = this.patchAttemptForRun(nextAttempt, attemptStatus, now, {
          status_reason: statusReason,
          output_artifacts: command.output_artifacts,
          partial_artifacts: command.partial_artifacts,
          usage: command.usage,
          metadata: command.metadata,
          execution_target_id: command.execution_target_id,
          policy_decision_ids: command.policy_decision_ids,
          approval_ids: command.approval_ids,
        });
        nextAttempts = nextAttempts.map((attempt) => (
          attempt.id === nextAttempt!.id ? nextAttempt! : attempt
        ));
        nextAttemptRequestMap = {
          ...nextAttemptRequestMap,
          [command.request_id]: nextAttempt.id,
        };
      }
      if (nextAttempt !== undefined && nextAttempt.id !== current.active_attempt_id) {
        patch.attempt_ids = [...(current.attempt_ids ?? []), nextAttempt.id];
        patch.active_attempt_id = nextAttempt.id;
        patch.attempt_count = (current.attempt_count ?? current.attempt_ids?.length ?? 0) + 1;
      }
      if (command.partial_artifacts !== undefined && nextAttempt !== undefined) {
        patch.partial_result = {
          attempt_id: nextAttempt.id,
          artifact_refs: command.partial_artifacts,
          reason: statusReason ?? 'attempt ended with partial output',
          recorded_at: now,
        };
      }
      const { status_reason: _currentReason, ...withoutReason } = current;
      const next = runSchema.parse({
        ...withoutReason,
        status: nextStatus,
        updated_at: now,
        ...patch,
        ...(statusReason === undefined
          ? sameStatus && current.status_reason !== undefined
            ? { status_reason: current.status_reason }
            : {}
          : { status_reason: statusReason }),
        ...(nextStatus === 'running' && current.started_at === undefined
          ? { started_at: now }
          : {}),
        ...(terminalStatuses.has(nextStatus) && current.completed_at === undefined
          ? { completed_at: now }
          : {}),
      });
      await this.replace(this.runs.map((run) => (run.id === id ? next : run)), nextAttempts, {
        ...this.requests,
        [command.request_id]: id,
      }, nextAttemptRequestMap);
      if (nextAttempt !== undefined && nextAttempt.id !== current.active_attempt_id) {
        await this.emitAttemptEvent(nextAttempt, command.request_id, 'created');
      } else if (nextAttempt !== undefined && attemptStatus !== undefined) {
        await this.emitAttemptEvent(nextAttempt, command.request_id, attemptEventType(nextAttempt.status));
      }
      await this.events.append({
        event_type: runEventType(nextStatus),
        entity_type: 'run',
        entity_id: id,
        request_id: command.request_id,
        actor: 'agent',
        state: next.status,
        payload: {
          agent_session_id: next.agent_session_id,
          ...(next.active_attempt_id === undefined ? {} : { attempt_id: next.active_attempt_id }),
          ...(statusReason === undefined ? {} : { reason: statusReason }),
          ...(next.output_artifacts === undefined ? {} : { output_artifacts: next.output_artifacts }),
        },
      });
      this.changes.fire(next);
      if (nextAttempt !== undefined) this.attemptChanges.fire(nextAttempt);
      return next;
    });
  }

  async cancel(id: string, input: RunActionInput): Promise<Run | undefined> {
    const command = runActionInputSchema.parse(input);
    return this.transition(id, {
      request_id: command.request_id,
      status: 'cancelled',
      status_reason: 'cancelled_by_request',
      metadata: command.metadata,
    });
  }

  async resume(id: string, input: RunActionInput): Promise<Run | undefined> {
    const command = runActionInputSchema.parse(input);
    return this.transition(id, {
      request_id: command.request_id,
      status: 'running',
      metadata: command.metadata,
    });
  }

  async retry(id: string, input: RunActionInput): Promise<Run | undefined> {
    return this.createChild(id, runActionInputSchema.parse(input), 'retry');
  }

  async rerun(id: string, input: RunActionInput): Promise<Run | undefined> {
    return this.createChild(id, runActionInputSchema.parse(input), 'rerun');
  }

  async fork(id: string, input: RunForkInput): Promise<Run | undefined> {
    const command = runForkInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const source = this.runs.find((run) => run.id === id);
      if (source === undefined) return undefined;
      const existingId = this.requests[command.request_id];
      if (existingId !== undefined) return this.require(existingId);
      const baseRun = this.materializeChild(source, {
        request_id: command.request_id,
        plan: command.plan,
        input_resources: command.input_resources,
        execution_target_id: command.execution_target_id,
        project_id: command.project_id,
        user_id: command.user_id,
        policy_decision_ids: command.policy_decision_ids,
        approval_ids: command.approval_ids,
        metadata: {
          ...source.metadata,
          ...command.metadata,
        },
      });
      const attempt = this.materializeAttempt(baseRun, {
        request_id: `${command.request_id}:attempt`,
        kind: 'fork',
        project_id: command.project_id,
        execution_target_id: command.execution_target_id,
        policy_decision_ids: command.policy_decision_ids,
        approval_ids: command.approval_ids,
        user_id: command.user_id,
      });
      const run = attachAttempt(baseRun, attempt);
      await this.replace([...this.runs, run], [...this.attempts, attempt], {
        ...this.requests,
        [command.request_id]: run.id,
      }, {
        ...this.attemptRequests,
        [`${command.request_id}:attempt`]: attempt.id,
      });
      await this.events.append({
        event_type: 'run.created',
        entity_type: 'run',
        entity_id: run.id,
        request_id: command.request_id,
        actor: 'agent',
        state: run.status,
        payload: { agent_session_id: run.agent_session_id, parent_run_id: source.id, attempt_id: attempt.id },
      });
      await this.emitAttemptEvent(attempt, command.request_id, 'created');
      this.changes.fire(run);
      this.attemptChanges.fire(attempt);
      return run;
    });
  }

  private async createChild(
    id: string,
    command: RunActionInput,
    operation: 'retry' | 'rerun',
  ): Promise<Run | undefined> {
    return this.enqueue(async () => {
      await this.ready;
      const source = this.runs.find((run) => run.id === id);
      if (source === undefined) return undefined;
      const existingId = this.requests[command.request_id];
      if (existingId !== undefined) return this.require(existingId);
      if (!terminalStatuses.has(source.status)) {
        throw new Error2(
          ErrorCodes.REQUEST_INVALID,
          `${operation} requires a terminal Run: ${id}`,
          { details: { runId: id, status: source.status } },
        );
      }
      const baseRun = this.materializeChild(source, {
        request_id: command.request_id,
        project_id: source.project_id,
        user_id: source.user_id,
        policy_decision_ids: source.policy_decision_ids,
        approval_ids: source.approval_ids,
        metadata: {
          ...source.metadata,
          ...command.metadata,
          [`${operation}_of`]: source.id,
        },
      });
      const attempt = this.materializeAttempt(baseRun, {
        request_id: `${command.request_id}:attempt`,
        kind: operation === 'retry' ? 'retry' : 'rerun',
        project_id: source.project_id,
        execution_target_id: source.execution_target_id,
        policy_decision_ids: source.policy_decision_ids,
        approval_ids: source.approval_ids,
        user_id: source.user_id,
        retry_of_attempt_id: operation === 'retry' ? source.active_attempt_id : undefined,
        parent_attempt_id: source.active_attempt_id,
      });
      const run = attachAttempt(baseRun, attempt);
      await this.replace([...this.runs, run], [...this.attempts, attempt], {
        ...this.requests,
        [command.request_id]: run.id,
      }, {
        ...this.attemptRequests,
        [`${command.request_id}:attempt`]: attempt.id,
      });
      await this.events.append({
        event_type: 'run.created',
        entity_type: 'run',
        entity_id: run.id,
        request_id: command.request_id,
        actor: 'agent',
        state: run.status,
        payload: { agent_session_id: run.agent_session_id, parent_run_id: source.id, attempt_id: attempt.id },
      });
      await this.emitAttemptEvent(attempt, command.request_id, 'created');
      this.changes.fire(run);
      this.attemptChanges.fire(attempt);
      return run;
    });
  }

  private materializeChild(
    source: Run,
    input: {
      readonly request_id: string;
      readonly plan?: Run['plan'];
      readonly input_resources?: Run['input_resources'];
      readonly execution_target_id?: string;
      readonly project_id?: string;
      readonly user_id?: string;
      readonly policy_decision_ids?: Run['policy_decision_ids'];
      readonly approval_ids?: Run['approval_ids'];
      readonly metadata?: Run['metadata'];
    },
  ): Run {
    const now = nowIsoDateTime();
    return runSchema.parse({
      id: `run_${ulid()}`,
      workspace_id: this.context.workspaceId,
      agent_session_id: this.context.sessionId,
      request_id: input.request_id,
      parent_run_id: source.id,
      status: 'queued',
      created_at: now,
      updated_at: now,
      plan: input.plan ?? source.plan,
      input_resources: input.input_resources ?? source.input_resources,
      execution_target_id: input.execution_target_id ?? source.execution_target_id,
      project_id: input.project_id ?? source.project_id,
      user_id: input.user_id ?? source.user_id,
      policy_decision_ids: input.policy_decision_ids ?? source.policy_decision_ids,
      approval_ids: input.approval_ids ?? source.approval_ids,
      metadata: input.metadata ?? source.metadata,
    });
  }

  private materializeAttempt(
    run: Run,
    input: {
      readonly request_id: string;
      readonly kind?: Attempt['kind'];
      readonly parent_attempt_id?: string;
      readonly retry_of_attempt_id?: string;
      readonly project_id?: string;
      readonly execution_target_id?: string;
      readonly provider?: string;
      readonly model?: string;
      readonly user_id?: string;
      readonly policy_decision_ids?: Attempt['policy_decision_ids'];
      readonly approval_ids?: Attempt['approval_ids'];
      readonly input_artifacts?: Attempt['input_artifacts'];
      readonly metadata?: Attempt['metadata'];
    },
  ): Attempt {
    const runAttempts = this.attempts.filter((attempt) => attempt.run_id === run.id);
    const now = nowIsoDateTime();
    return attemptSchema.parse({
      id: `attempt_${ulid()}`,
      run_id: run.id,
      workspace_id: this.context.workspaceId,
      agent_session_id: this.context.sessionId,
      request_id: input.request_id,
      attempt_number: runAttempts.length + 1,
      kind: input.kind ?? 'retry',
      status: 'queued',
      parent_attempt_id: input.parent_attempt_id,
      retry_of_attempt_id: input.retry_of_attempt_id,
      created_at: now,
      updated_at: now,
      project_id: input.project_id ?? run.project_id,
      execution_target_id: input.execution_target_id ?? run.execution_target_id,
      provider: input.provider,
      model: input.model,
      user_id: input.user_id ?? run.user_id,
      policy_decision_ids: input.policy_decision_ids ?? run.policy_decision_ids,
      approval_ids: input.approval_ids ?? run.approval_ids,
      input_artifacts: input.input_artifacts,
      metadata: input.metadata,
    });
  }

  private patchAttemptForRun(
    current: Attempt,
    status: AttemptStatus,
    now: string,
    input: Partial<AttemptTransitionInput> & { readonly status_reason?: string },
  ): Attempt {
    const { completed_at: _completedAt, status_reason: currentReason, ...withoutCompletion } = current;
    const metadata = input.metadata === undefined
      ? current.metadata
      : { ...current.metadata, ...input.metadata };
    return attemptSchema.parse({
      ...withoutCompletion,
      status,
      updated_at: now,
      ...(status === 'running' && current.started_at === undefined ? { started_at: now } : {}),
      ...(terminalAttemptStatuses.has(status) ? { completed_at: current.completed_at ?? now } : {}),
      ...(input.status_reason === undefined
        ? currentReason === undefined ? {} : { status_reason: currentReason }
        : { status_reason: input.status_reason }),
      ...(input.execution_target_id === undefined ? {} : { execution_target_id: input.execution_target_id }),
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.policy_decision_ids === undefined ? {} : { policy_decision_ids: input.policy_decision_ids }),
      ...(input.approval_ids === undefined ? {} : { approval_ids: input.approval_ids }),
      ...(input.output_artifacts === undefined ? {} : { output_artifacts: input.output_artifacts }),
      ...(input.partial_artifacts === undefined ? {} : { partial_artifacts: input.partial_artifacts }),
      ...(input.usage === undefined ? {} : { usage: input.usage }),
      ...(metadata === undefined ? {} : { metadata }),
    });
  }

  private async emitAttemptEvent(
    attempt: Attempt,
    requestId: string,
    kind: 'created' | 'state_changed' | 'completed' | 'failed' | 'cancelled',
  ): Promise<void> {
    await this.events.append({
      event_type: `attempt.${kind}`,
      entity_type: 'attempt',
      entity_id: attempt.id,
      request_id: requestId,
      actor: 'agent',
      state: attempt.status,
      payload: attemptTracePayload(attempt),
    });
  }

  private async load(): Promise<void> {
    const raw = await this.store.get<unknown>(this.scope, RUNS_KEY);
    if (raw === undefined) {
      await this.replace([], [], {}, {});
      return;
    }
    const current = runsDocumentSchema.safeParse(raw);
    const document = current.success
      ? current.data
      : (() => {
        const legacy = legacyRunsDocumentSchema.parse(raw);
        return {
          version: RUNS_DOCUMENT_VERSION as 2,
          runs: legacy.runs,
          attempts: [],
          requests: legacy.requests,
          attempt_requests: {},
        };
      })();
    const migrated = reconcileAttemptProjection(
      document.runs,
      document.attempts,
      this.context.workspaceId,
      this.context.sessionId,
    );
    this.runs = migrated.runs;
    this.attempts = migrated.attempts;
    this.requests = document.requests;
    this.attemptRequests = document.attempt_requests;
    for (const attempt of migrated.attempts) {
      if (attempt.request_id !== undefined && this.attemptRequests[attempt.request_id] === undefined) {
        this.attemptRequests[attempt.request_id] = attempt.id;
      }
    }
    await this.replace(this.runs, this.attempts, this.requests, this.attemptRequests);
  }

  private async replace(
    runs: readonly Run[],
    attempts: readonly Attempt[] = this.attempts,
    requests: Record<string, string> = this.requests,
    attemptRequests: Record<string, string> = this.attemptRequests,
  ): Promise<void> {
    await this.store.set(this.scope, RUNS_KEY, {
      version: RUNS_DOCUMENT_VERSION,
      runs,
      attempts,
      requests,
      attempt_requests: attemptRequests,
    });
    this.runs = runs;
    this.attempts = attempts;
    this.requests = requests;
    this.attemptRequests = attemptRequests;
  }

  private require(id: string): Run {
    const run = this.runs.find((candidate) => candidate.id === id);
    if (run === undefined) {
      throw new Error2(ErrorCodes.REQUEST_INVALID, `run not found: ${id}`, {
        details: { runId: id },
      });
    }
    return run;
  }

  private requireAttempt(id: string): Attempt {
    const attempt = this.attempts.find((candidate) => candidate.id === id);
    if (attempt === undefined) {
      throw new Error2(ErrorCodes.REQUEST_INVALID, `attempt not found: ${id}`, {
        details: { attemptId: id },
      });
    }
    return attempt;
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

function attachAttempt(run: Run, attempt: Attempt): Run {
  const attemptIds = [...new Set([...(run.attempt_ids ?? []), attempt.id])];
  return runSchema.parse({
    ...run,
    attempt_ids: attemptIds,
    active_attempt_id: attempt.id,
    attempt_count: attemptIds.length,
  });
}

function attemptStatusForRunStatus(
  status: RunStatus,
  partialArtifacts: RunTransitionInput['partial_artifacts'],
): AttemptStatus | undefined {
  if (status === 'planning') return 'planning';
  if (status === 'awaiting_approval') return 'awaiting_approval';
  if (status === 'running') return 'running';
  if (status === 'succeeded') return 'succeeded';
  if (status === 'failed') return partialArtifacts === undefined ? 'failed' : 'partial';
  if (status === 'cancelled') return partialArtifacts === undefined ? 'cancelled' : 'partial';
  return 'queued';
}

function runForAttempt(run: Run, attempt: Attempt, now: string): Run {
  const projectedStatus = runStatusForAttempt(run, attempt);
  const partialResult = attempt.status === 'partial'
    ? {
      attempt_id: attempt.id,
      artifact_refs: attempt.partial_artifacts ?? [],
      reason: attempt.status_reason ?? 'attempt ended with partial output',
      recorded_at: now,
    }
    : run.partial_result;
  const next = runSchema.parse({
    ...run,
    status: projectedStatus,
    updated_at: now,
    ...(projectedStatus === 'running' && run.started_at === undefined ? { started_at: now } : {}),
    ...(terminalStatuses.has(projectedStatus) && run.completed_at === undefined ? { completed_at: now } : {}),
    ...(attempt.output_artifacts === undefined ? {} : { output_artifacts: attempt.output_artifacts }),
    ...(partialResult === undefined ? {} : { partial_result: partialResult }),
    attempt_ids: run.attempt_ids?.includes(attempt.id)
      ? run.attempt_ids
      : [...(run.attempt_ids ?? []), attempt.id],
    active_attempt_id: attempt.id,
    attempt_count: Math.max(run.attempt_count ?? 0, (run.attempt_ids?.length ?? 0) + (run.attempt_ids?.includes(attempt.id) ? 0 : 1)),
    ...(attempt.status_reason === undefined ? {} : { status_reason: attempt.status_reason }),
  });
  return next;
}

function runStatusForAttempt(run: Run, attempt: Attempt): RunStatus {
  return attempt.status === 'planning'
    ? run.status === 'queued' || run.status === 'planning' ? 'planning' : run.status
    : attempt.status === 'awaiting_approval'
      ? 'awaiting_approval'
      : attempt.status === 'running'
        ? 'running'
        : attempt.status === 'succeeded'
          ? 'succeeded'
          : attempt.status === 'failed' || attempt.status === 'partial'
            ? 'failed'
            : attempt.status === 'cancelled'
              ? 'cancelled'
              : run.status;
}

function attemptEventType(
  status: AttemptStatus,
): 'state_changed' | 'completed' | 'failed' | 'cancelled' {
  if (status === 'succeeded') return 'completed';
  if (status === 'failed' || status === 'partial') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return 'state_changed';
}

function attemptTracePayload(attempt: Attempt): Record<string, unknown> {
  const artifactIds = [
    ...(attempt.input_artifacts ?? []).map((artifact) => artifact.id),
    ...(attempt.output_artifacts ?? []).map((artifact) => artifact.id),
    ...(attempt.partial_artifacts ?? []).map((artifact) => artifact.id),
  ];
  return {
    run_id: attempt.run_id,
    attempt_id: attempt.id,
    workspace_id: attempt.workspace_id,
    ...(attempt.project_id === undefined ? {} : { project_id: attempt.project_id }),
    ...(attempt.execution_target_id === undefined ? {} : { execution_target_id: attempt.execution_target_id }),
    ...(attempt.provider === undefined ? {} : { provider: attempt.provider }),
    ...(attempt.model === undefined ? {} : { model: attempt.model }),
    ...(attempt.user_id === undefined ? {} : { user_id: attempt.user_id }),
    ...(attempt.policy_decision_ids === undefined ? {} : { policy_decision_ids: attempt.policy_decision_ids }),
    ...(attempt.approval_ids === undefined ? {} : { approval_ids: attempt.approval_ids }),
    ...(artifactIds.length === 0 ? {} : { artifact_ids: [...new Set(artifactIds)] }),
    ...(attempt.usage === undefined ? {} : { usage: attempt.usage }),
  };
}

function stringMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function reconcileAttemptProjection(
  runs: readonly Run[],
  existingAttempts: readonly Attempt[],
  workspaceId: string,
  sessionId: string,
): { readonly runs: readonly Run[]; readonly attempts: readonly Attempt[] } {
  const attempts = [...existingAttempts];
  const projectedRuns = runs.map((run) => {
    const associated = attempts
      .filter((attempt) => attempt.run_id === run.id)
      .sort((left, right) => left.attempt_number - right.attempt_number);
    if (associated.length === 0) {
      const legacyAttempt = attemptSchema.parse({
        id: `attempt_${ulid()}`,
        run_id: run.id,
        workspace_id: workspaceId,
        agent_session_id: sessionId,
        request_id: run.request_id === undefined ? undefined : `${run.request_id}:attempt`,
        attempt_number: 1,
        kind: 'recovery',
        status: 'recovered',
        created_at: run.created_at,
        updated_at: run.updated_at,
        completed_at: run.completed_at,
        project_id: run.project_id,
        execution_target_id: run.execution_target_id,
        user_id: run.user_id,
        policy_decision_ids: run.policy_decision_ids,
        approval_ids: run.approval_ids,
        status_reason: 'legacy Run migrated without an Attempt record',
      });
      attempts.push(legacyAttempt);
      associated.push(legacyAttempt);
    }
    const attemptIds = associated.map((attempt) => attempt.id);
    return runSchema.parse({
      ...run,
      attempt_ids: attemptIds,
      active_attempt_id: run.active_attempt_id ?? associated.at(-1)?.id,
      attempt_count: attemptIds.length,
    });
  });
  return { runs: projectedRuns, attempts };
}

function assertSafeMetadata(metadata: Readonly<Record<string, unknown>> | undefined): void {
  const path = findSensitivePlatformMetadataPath(metadata);
  if (path !== undefined) {
    throw new Error2(
      ErrorCodes.REQUEST_INVALID,
      `Run metadata cannot contain secret material in '${path}'`,
      { details: { key: path } },
    );
  }
}

function findIncompleteRequiredChild(runs: readonly Run[], parentRunId: string): Run | undefined {
  return runs.find((run) => (
    run.parent_run_id === parentRunId
    && run.metadata?.['required'] === true
    && run.status !== 'succeeded'
  ));
}

function runEventType(status: RunStatus): 'run.updated' | 'run.completed' | 'run.failed' | 'run.cancelled' {
  if (status === 'succeeded') return 'run.completed';
  if (status === 'failed') return 'run.failed';
  if (status === 'cancelled') return 'run.cancelled';
  return 'run.updated';
}

registerScopedService(
  LifecycleScope.Session,
  ISessionRunService,
  SessionRunService,
  ScopeActivation.OnScopeCreated,
  'run',
);
