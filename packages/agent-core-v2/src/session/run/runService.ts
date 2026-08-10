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
  nowIsoDateTime,
  runActionInputSchema,
  runCreateInputSchema,
  runForkInputSchema,
  runSchema,
  runTransitionInputSchema,
  type Run,
  type RunActionInput,
  type RunCreateInput,
  type RunForkInput,
  type RunStatus,
  type RunTransitionInput,
} from '@moonshot-ai/protocol';

import { ISessionRunService, RunStateError } from './run';

const RUNS_KEY = 'runs.json';
const RUNS_DOCUMENT_VERSION = 1;

const runsDocumentSchema = z.strictObject({
  version: z.literal(RUNS_DOCUMENT_VERSION),
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

export class SessionRunService extends Disposable implements ISessionRunService {
  declare readonly _serviceBrand: undefined;

  readonly onDidChange: Event<Run>;
  readonly ready: Promise<void>;

  private readonly changes = this._register(new Emitter<Run>());
  private readonly scope: string;
  private runs: readonly Run[] = [];
  private requests: Record<string, string> = {};
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    @IAtomicDocumentStore private readonly store: IAtomicDocumentStore,
    @ISessionContext private readonly context: ISessionContext,
    @IWorkspacePlatformEventService private readonly events: IWorkspacePlatformEventService,
  ) {
    super();
    this.scope = context.scope('platform');
    this.onDidChange = this.changes.event;
    this.ready = this.load();
  }

  async list(): Promise<readonly Run[]> {
    await this.ready;
    return [...this.runs];
  }

  async get(id: string): Promise<Run | undefined> {
    await this.ready;
    return this.runs.find((run) => run.id === id);
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
      const run = runSchema.parse({
        id: `run_${ulid()}`,
        workspace_id: this.context.workspaceId,
        agent_session_id: this.context.sessionId,
        status: 'queued',
        created_at: now,
        updated_at: now,
        ...command,
      });
      await this.replace([...this.runs, run], {
        ...this.requests,
        [command.request_id]: run.id,
      });
      await this.events.append({
        event_type: 'run.created',
        entity_type: 'run',
        entity_id: run.id,
        request_id: command.request_id,
        actor: 'agent',
        state: run.status,
        payload: { agent_session_id: run.agent_session_id },
      });
      this.changes.fire(run);
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
        patch.metadata = { ...(current.metadata ?? {}), ...command.metadata };
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
      await this.replace(this.runs.map((run) => (run.id === id ? next : run)), {
        ...this.requests,
        [command.request_id]: id,
      });
      await this.events.append({
        event_type: runEventType(nextStatus),
        entity_type: 'run',
        entity_id: id,
        request_id: command.request_id,
        actor: 'agent',
        state: next.status,
        payload: {
          agent_session_id: next.agent_session_id,
          ...(statusReason === undefined ? {} : { reason: statusReason }),
          ...(next.output_artifacts === undefined ? {} : { output_artifacts: next.output_artifacts }),
        },
      });
      this.changes.fire(next);
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
      const run = this.materializeChild(source, {
        request_id: command.request_id,
        plan: command.plan,
        input_resources: command.input_resources,
        execution_target_id: command.execution_target_id,
        metadata: {
          ...source.metadata,
          ...command.metadata,
        },
      });
      await this.replace([...this.runs, run], {
        ...this.requests,
        [command.request_id]: run.id,
      });
      await this.events.append({
        event_type: 'run.created',
        entity_type: 'run',
        entity_id: run.id,
        request_id: command.request_id,
        actor: 'agent',
        state: run.status,
        payload: { agent_session_id: run.agent_session_id, parent_run_id: source.id },
      });
      this.changes.fire(run);
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
      const run = this.materializeChild(source, {
        request_id: command.request_id,
        metadata: {
          ...source.metadata,
          ...command.metadata,
          [`${operation}_of`]: source.id,
        },
      });
      await this.replace([...this.runs, run], {
        ...this.requests,
        [command.request_id]: run.id,
      });
      await this.events.append({
        event_type: 'run.created',
        entity_type: 'run',
        entity_id: run.id,
        request_id: command.request_id,
        actor: 'agent',
        state: run.status,
        payload: { agent_session_id: run.agent_session_id, parent_run_id: source.id },
      });
      this.changes.fire(run);
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
      metadata: input.metadata ?? source.metadata,
    });
  }

  private async load(): Promise<void> {
    const raw = await this.store.get<unknown>(this.scope, RUNS_KEY);
    if (raw === undefined) {
      await this.replace([]);
      return;
    }
    const document = runsDocumentSchema.parse(raw);
    this.runs = document.runs;
    this.requests = document.requests;
  }

  private async replace(
    runs: readonly Run[],
    requests: Record<string, string> = this.requests,
  ): Promise<void> {
    await this.store.set(this.scope, RUNS_KEY, {
      version: RUNS_DOCUMENT_VERSION,
      runs,
      requests,
    });
    this.runs = runs;
    this.requests = requests;
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

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(work, work);
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
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
