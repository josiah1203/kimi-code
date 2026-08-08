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
import type {
  Run,
  RunCreateInput,
  RunStatus,
  RunTransitionInput,
} from '@moonshot-ai/protocol';

export type { Run, RunCreateInput, RunStatus, RunTransitionInput } from '@moonshot-ai/protocol';

export interface ISessionRunService {
  readonly _serviceBrand: undefined;

  /** Resolves after the session's durable Run document has been loaded. */
  readonly ready: Promise<void>;
  list(): Promise<readonly Run[]>;
  get(id: string): Promise<Run | undefined>;
  create(input: RunCreateInput): Promise<Run>;
  transition(id: string, input: RunTransitionInput): Promise<Run | undefined>;
  readonly onDidChange: Event<Run>;
}

export const ISessionRunService: ServiceIdentifier<ISessionRunService> =
  createDecorator<ISessionRunService>('sessionRunService');

export class RunStateError extends Error {
  readonly code = 'RUN_INVALID_STATE_TRANSITION';

  constructor(
    readonly runId: string,
    readonly from: RunStatus,
    readonly to: RunStatus,
  ) {
    super(`run ${runId} cannot transition from ${from} to ${to}`);
    this.name = 'RunStateError';
  }
}
