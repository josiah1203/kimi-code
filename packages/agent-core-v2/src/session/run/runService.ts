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
import {
  nowIsoDateTime,
  runCreateInputSchema,
  runSchema,
  runTransitionInputSchema,
  type Run,
  type RunCreateInput,
  type RunStatus,
  type RunTransitionInput,
} from '@moonshot-ai/protocol';

import { ISessionRunService, RunStateError } from './run';

const RUNS_KEY = 'runs.json';
const RUNS_DOCUMENT_VERSION = 1;

const runsDocumentSchema = z.strictObject({
  version: z.literal(RUNS_DOCUMENT_VERSION),
  runs: z.array(runSchema),
});

const allowedTransitions: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  queued: ['planning', 'running', 'failed', 'cancelled'],
  planning: ['awaiting_approval', 'running', 'failed', 'cancelled'],
  awaiting_approval: ['running', 'failed', 'cancelled'],
  running: ['succeeded', 'failed', 'cancelled'],
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
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    @IAtomicDocumentStore private readonly store: IAtomicDocumentStore,
    @ISessionContext private readonly context: ISessionContext,
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
    return this.enqueue(async () => {
      await this.ready;
      if (
        command.parent_run_id !== undefined &&
        !this.runs.some((run) => run.id === command.parent_run_id)
      ) {
        throw new Error(`parent run not found: ${command.parent_run_id}`);
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
      await this.replace([...this.runs, run]);
      this.changes.fire(run);
      return run;
    });
  }

  async transition(id: string, input: RunTransitionInput): Promise<Run | undefined> {
    const command = runTransitionInputSchema.parse(input);
    return this.enqueue(async () => {
      await this.ready;
      const current = this.runs.find((run) => run.id === id);
      if (current === undefined) return undefined;
      if (current.status === command.status) return current;
      if (!allowedTransitions[current.status].includes(command.status)) {
        throw new RunStateError(id, current.status, command.status);
      }

      const now = nowIsoDateTime();
      const { status_reason: _previousReason, ...withoutReason } = current;
      const next = runSchema.parse({
        ...withoutReason,
        status: command.status,
        updated_at: now,
        ...(command.status_reason === undefined
          ? {}
          : { status_reason: command.status_reason }),
        ...(command.status === 'running' && current.started_at === undefined
          ? { started_at: now }
          : {}),
        ...(terminalStatuses.has(command.status) && current.completed_at === undefined
          ? { completed_at: now }
          : {}),
      });
      await this.replace(this.runs.map((run) => (run.id === id ? next : run)));
      this.changes.fire(next);
      return next;
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
  }

  private async replace(runs: readonly Run[]): Promise<void> {
    await this.store.set(this.scope, RUNS_KEY, {
      version: RUNS_DOCUMENT_VERSION,
      runs,
    });
    this.runs = runs;
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

registerScopedService(
  LifecycleScope.Session,
  ISessionRunService,
  SessionRunService,
  ScopeActivation.OnScopeCreated,
  'run',
);
