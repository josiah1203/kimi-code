/** `/api/v2/platform/ws` — replayable workspace platform event stream. */

import type { Scope } from '@spiderbyte/agent-core';
import {
  IFlagService,
  IWorkspaceLifecycleService,
  IWorkspacePlatformEventService,
  IWorkspaceService,
} from '@spiderbyte/agent-core';
import {
  platformEntityTypeSchema,
  platformLifecycleEventTypeSchema,
  type PlatformLifecycleEvent,
  type PlatformReplayPage,
} from '@spiderbyte/protocol';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';

import { ErrorCode } from '../../../protocol/error-codes';
import { mapPlatformError } from '../../../routes/v2/platformErrors';

export const WS_PATH_V2_PLATFORM = '/api/v2/platform/ws';

const controlSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('subscribe'),
    request_id: z.string().min(1),
    workspace_id: z.string().min(1),
    after_sequence: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(500).optional(),
    event_types: z.array(platformLifecycleEventTypeSchema).min(1).max(32).optional(),
    entity_types: z.array(platformEntityTypeSchema).min(1).max(10).optional(),
  }),
  z.strictObject({
    type: z.literal('replay'),
    request_id: z.string().min(1),
    after_sequence: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(500).optional(),
    event_types: z.array(platformLifecycleEventTypeSchema).min(1).max(32).optional(),
    entity_types: z.array(platformEntityTypeSchema).min(1).max(10).optional(),
  }),
]);

type PlatformEventFilter = Pick<z.infer<typeof controlSchema>, 'event_types' | 'entity_types'>;

function rawDataToText(raw: WebSocket.RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString();
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString();
  return raw.toString();
}

export function registerPlatformWs(core: Scope): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (socket) => {
    const connection = new PlatformWsConnection(core, socket);
    socket.on('message', (raw) => void connection.handle(rawDataToText(raw)));
    socket.on('close', () => connection.dispose());
    socket.on('error', () => connection.dispose());
  });
  return wss;
}

class PlatformWsConnection {
  private workspaceId: string | undefined;
  private unsubscribe: { dispose(): void } | undefined;
  private filter: PlatformEventFilter = {};

  constructor(private readonly core: Scope, private readonly socket: WebSocket) {}

  async handle(raw: string): Promise<void> {
    let control: z.infer<typeof controlSchema>;
    try {
      control = controlSchema.parse(JSON.parse(raw));
    } catch (error) {
      this.send({
        type: 'error',
        code: ErrorCode.VALIDATION_FAILED,
        msg: 'invalid platform websocket message',
        details: error instanceof z.ZodError
          ? error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
          : undefined,
      });
      return;
    }

    if (!this.core.accessor.get(IFlagService).enabled('platform_services')) {
      this.send({
        type: 'ack',
        request_id: control.request_id,
        code: ErrorCode.PLATFORM_DISABLED,
        msg: 'platform services are disabled',
        data: null,
      });
      return;
    }

    const requestedWorkspaceId = control.type === 'subscribe'
      ? control.workspace_id
      : this.workspaceId;
    if (control.type === 'subscribe') {
      // The workspace is committed to the connection only after its lifecycle
      // handle resolves successfully below.
    } else if (requestedWorkspaceId === undefined) {
      this.send({
        type: 'ack',
        request_id: control.request_id,
        code: ErrorCode.VALIDATION_FAILED,
        msg: 'subscribe before replay',
        data: null,
      });
      return;
    }

    try {
      const workspaceId = requestedWorkspaceId as string;
      const accessor = await resolveWorkspace(this.core, workspaceId);
      if (accessor === undefined) {
        this.send({
          type: 'ack',
          request_id: control.request_id,
          code: ErrorCode.WORKSPACE_NOT_FOUND,
          msg: 'workspace not found',
          data: null,
        });
        return;
      }
      const events = accessor.get(IWorkspacePlatformEventService);
      await events.ready;
      if (control.type === 'subscribe') {
        this.unsubscribe?.dispose();
        this.workspaceId = workspaceId;
        this.filter = control;
        this.unsubscribe = events.onDidChange((event) => {
          if (
            this.socket.readyState === this.socket.OPEN &&
            event.workspace_id === this.workspaceId &&
            matchesFilter(event, this.filter)
          ) {
            this.send({ type: 'platform_event', event });
          }
        });
      }
      const page = await replayFiltered(
        events,
        control.after_sequence ?? 0,
        control.limit ?? 100,
        control,
      );
      this.send({
        type: 'ack',
        request_id: control.request_id,
        code: ErrorCode.SUCCESS,
        msg: 'ok',
        data: page,
      });
      for (const event of page.events) this.send({ type: 'platform_event', event });
    } catch (error) {
      const mapped = mapPlatformError(error, control.request_id);
      this.send({
        type: 'ack',
        request_id: control.request_id,
        code: mapped.code,
        msg: mapped.msg,
        data: null,
      });
    }
  }

  dispose(): void {
    this.unsubscribe?.dispose();
    this.unsubscribe = undefined;
  }

  private send(value: unknown): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(value));
  }
}

async function resolveWorkspace(core: Scope, workspaceId: string) {
  const workspace = await core.accessor.get(IWorkspaceService).get(workspaceId);
  if (workspace === undefined) return undefined;
  const handle = await core.accessor.get(IWorkspaceLifecycleService).handlerFor({
    workspaceId,
    root: workspace.root,
  });
  return handle.accessor;
}

function matchesFilter(event: PlatformLifecycleEvent, filter: PlatformEventFilter): boolean {
  return (
    (filter.event_types === undefined || filter.event_types.includes(event.event_type)) &&
    (filter.entity_types === undefined || filter.entity_types.includes(event.entity_type))
  );
}

async function replayFiltered(
  events: IWorkspacePlatformEventService,
  afterSequence: number,
  limit: number,
  filter: PlatformEventFilter,
): Promise<PlatformReplayPage> {
  if (filter.event_types === undefined && filter.entity_types === undefined) {
    return events.replay(afterSequence, limit);
  }

  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
  let cursor = Math.max(0, Math.trunc(afterSequence));
  let sourceHasMore = false;
  const matched: PlatformLifecycleEvent[] = [];
  for (;;) {
    const page = await events.replay(cursor, 500);
    sourceHasMore = page.has_more;
    matched.push(...page.events.filter((event) => matchesFilter(event, filter)));
    cursor = page.next_sequence;
    if (!page.has_more || page.events.length === 0 || matched.length >= boundedLimit) break;
  }

  const returned = matched.slice(0, boundedLimit);
  const nextSequence = returned.at(-1)?.sequence ?? cursor;
  return {
    events: returned,
    next_sequence: nextSequence,
    has_more: matched.length > boundedLimit || sourceHasMore,
  };
}
