/** Durable append-only journal for workspace platform lifecycle events. */

import { ulid } from 'ulid';
import { z } from 'zod';

import { Disposable } from '#/_base/di/lifecycle';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { Emitter, type Event } from '#/_base/event';
import { IAppendLogStore } from '#/persistence/interface/appendLogStore';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import {
  nowIsoDateTime,
  platformLifecycleEventSchema,
  type PlatformLifecycleEvent,
  type PlatformReplayPage,
} from '@moonshot-ai/protocol';

import {
  IWorkspacePlatformEventService,
  type WorkspacePlatformEventInput,
} from './platformEvents';
import { PlatformEventErrors, PlatformEventServiceError } from './errors';
import { findSensitivePlatformMetadataPath } from '#/workspace/platformServices/metadata';

const EVENT_KEY = 'platform-events.jsonl';
const eventInputSchema = z.strictObject({
  event_type: z.string(),
  entity_type: z.string(),
  entity_id: z.string(),
  request_id: z.string().optional(),
  actor: z.enum(['user', 'agent', 'system', 'automation', 'policy']),
  state: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export class WorkspacePlatformEventService
  extends Disposable
  implements IWorkspacePlatformEventService
{
  declare readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  readonly onDidChange: Event<PlatformLifecycleEvent>;

  private readonly changes = this._register(new Emitter<PlatformLifecycleEvent>());
  private readonly scope: string;
  private events: readonly PlatformLifecycleEvent[] = [];
  private sequence = 0;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    @IAppendLogStore private readonly log: IAppendLogStore,
    @IWorkspaceContext private readonly context: IWorkspaceContext,
  ) {
    super();
    this.scope = `${context.persistenceScope}/platform`;
    this.onDidChange = this.changes.event;
    this._register(this.log.acquire(this.scope, EVENT_KEY));
    this.ready = this.load();
  }

  async append(input: WorkspacePlatformEventInput): Promise<PlatformLifecycleEvent> {
    const command = eventInputSchema.parse(input) as WorkspacePlatformEventInput;
    const path = findSensitivePlatformMetadataPath(command.payload);
    if (path !== undefined) {
      throw new PlatformEventServiceError(
        PlatformEventErrors.codes.PLATFORM_EVENT_SECRET_MATERIAL,
        `platform event payload cannot contain secret material in '${path}'`,
        { key: path },
      );
    }
    return this.enqueue(async () => {
      await this.ready;
      const event = platformLifecycleEventSchema.parse({
        ...command,
        event_id: `event_${ulid()}`,
        workspace_id: this.context.workspaceId,
        sequence: this.sequence + 1,
        occurred_at: nowIsoDateTime(),
      });
      this.log.append(this.scope, EVENT_KEY, event);
      await this.log.flush();
      this.events = [...this.events, event];
      this.sequence = event.sequence;
      this.changes.fire(event);
      return event;
    });
  }

  async replay(afterSequence = 0, limit = 100): Promise<PlatformReplayPage> {
    await this.ready;
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const events = this.events
      .filter((event) => event.sequence > Math.max(0, Math.trunc(afterSequence)))
      .slice(0, boundedLimit);
    const nextSequence = events.at(-1)?.sequence ?? Math.max(0, Math.trunc(afterSequence));
    const hasMore = this.events.some((event) => event.sequence > nextSequence);
    return { events, next_sequence: nextSequence, has_more: hasMore };
  }

  private async load(): Promise<void> {
    const events: PlatformLifecycleEvent[] = [];
    for await (const raw of this.log.read<unknown>(this.scope, EVENT_KEY)) {
      const parsed = platformLifecycleEventSchema.safeParse(raw);
      if (parsed.success && parsed.data.workspace_id === this.context.workspaceId) {
        events.push(parsed.data);
      }
    }
    events.sort((left, right) => left.sequence - right.sequence);
    this.events = events;
    this.sequence = events.at(-1)?.sequence ?? 0;
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
  LifecycleScope.Workspace,
  IWorkspacePlatformEventService,
  WorkspacePlatformEventService,
  ScopeActivation.OnScopeCreated,
  'platformEvents',
);
