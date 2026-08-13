/**
 * `run` domain — the durable execution unit inside an AgentSession.
 *
 * Runs are session metadata and lifecycle state, not a second agent engine.
 * Prompt execution, wire history, and agent ownership remain in the existing
 * agent/session services; this contract gives platform callers one durable id
 * and one lifecycle vocabulary to observe.
 */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type { Event } from '#/_base/event';
import { Error2, ErrorCodes } from '#/errors';
import type {
  Attempt,
  AttemptActionInput,
  AttemptCreateInput,
  AttemptStatus,
  AttemptTransitionInput,
  Run,
  RunActionInput,
  RunCreateInput,
  RunForkInput,
  RunStatus,
  RunTransitionInput,
} from '@spiderbyte/protocol';

export type {
  Attempt,
  AttemptActionInput,
  AttemptCreateInput,
  AttemptStatus,
  AttemptTransitionInput,
  Run,
  RunActionInput,
  RunCreateInput,
  RunForkInput,
  RunStatus,
  RunTransitionInput,
} from '@spiderbyte/protocol';

export interface ISessionRunService {
  readonly _serviceBrand: undefined;

  /** Resolves after the session's durable Run document has been loaded. */
  readonly ready: Promise<void>;
  /** Settles the durable mutation queue before session copy or teardown. */
  drain(): Promise<void>;
  list(): Promise<readonly Run[]>;
  get(id: string): Promise<Run | undefined>;
  create(input: RunCreateInput): Promise<Run>;
  transition(id: string, input: RunTransitionInput): Promise<Run | undefined>;
  resume(id: string, input: RunActionInput): Promise<Run | undefined>;
  cancel(id: string, input: RunActionInput): Promise<Run | undefined>;
  retry(id: string, input: RunActionInput): Promise<Run | undefined>;
  rerun(id: string, input: RunActionInput): Promise<Run | undefined>;
  fork(id: string, input: RunForkInput): Promise<Run | undefined>;
  /** Lists the execution Attempts owned by this session, optionally by Run. */
  listAttempts(runId?: string): Promise<readonly Attempt[]>;
  getAttempt(id: string): Promise<Attempt | undefined>;
  /** Creates a new execution try without creating a second logical Run. */
  createAttempt(runId: string, input: AttemptCreateInput): Promise<Attempt | undefined>;
  transitionAttempt(id: string, input: AttemptTransitionInput): Promise<Attempt | undefined>;
  resumeAttempt(id: string, input: AttemptActionInput): Promise<Attempt | undefined>;
  cancelAttempt(id: string, input: AttemptActionInput): Promise<Attempt | undefined>;
  retryAttempt(runId: string, input: AttemptActionInput): Promise<Attempt | undefined>;
  readonly onDidChange: Event<Run>;
  readonly onDidChangeAttempt: Event<Attempt>;
}

export const ISessionRunService: ServiceIdentifier<ISessionRunService> =
  createDecorator<ISessionRunService>('sessionRunService');

export class RunStateError extends Error2 {
  constructor(
    readonly runId: string,
    readonly from: RunStatus,
    readonly to: RunStatus,
  ) {
    super(ErrorCodes.REQUEST_INVALID, `run ${runId} cannot transition from ${from} to ${to}`, {
      name: 'RunStateError',
      details: { runId, from, to },
    });
  }
}

export class AttemptStateError extends Error2 {
  constructor(
    readonly attemptId: string,
    readonly from: AttemptStatus,
    readonly to: AttemptStatus,
  ) {
    super(ErrorCodes.REQUEST_INVALID, `attempt ${attemptId} cannot transition from ${from} to ${to}`, {
      name: 'AttemptStateError',
      details: { attemptId, from, to },
    });
  }
}
