/** `/api/v2/collaboration/ws` — durable collaboration message stream. */

import type { Scope } from '@spiderbyte/agent-core';
import { IFlagService } from '@spiderbyte/agent-core';
import {
  collaborationWsControlSchema,
  type CollaborationMessagePage,
  type DelegatedPrincipal,
} from '@spiderbyte/protocol';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';

import { ErrorCode } from '../../../protocol/error-codes';
import {
  CollaborationError,
  CollaborationService,
} from '../../../services/collaborationService';
import {
  runWithRequestDelegatedPrincipal,
  webSocketRequestDelegatedPrincipal,
} from '../../../services/auth/requestPrincipal';
import { selectWsBearerProtocol } from '../bearerProtocol';

export const WS_PATH_V2_COLLABORATION = '/api/v2/collaboration/ws';

const POLL_INTERVAL_MS = 500;
const DEFAULT_LIMIT = 100;

function rawDataToText(raw: WebSocket.RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString();
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString();
  return raw.toString();
}

export function registerCollaborationWs(
  core: Scope,
  collaboration: CollaborationService,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, handleProtocols: selectWsBearerProtocol });
  wss.on('connection', (socket, req) => {
    const connection = new CollaborationWsConnection(
      core,
      collaboration,
      socket,
      webSocketRequestDelegatedPrincipal(req),
    );
    socket.on('message', (raw) => void runWithRequestDelegatedPrincipal(
      connection.delegatedPrincipal,
      () => connection.handle(rawDataToText(raw)),
    ));
    socket.on('close', () => { connection.dispose(); });
    socket.on('error', () => { connection.dispose(); });
  });
  return wss;
}

class CollaborationWsConnection {
  private workspaceId: string | undefined;
  private channelId: string | undefined;
  private threadId: string | undefined;
  private requestId: string | undefined;
  private cursor = 0;
  private limit = DEFAULT_LIMIT;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private polling = false;
  private disposed = false;

  constructor(
    private readonly core: Scope,
    private readonly collaboration: CollaborationService,
    private readonly socket: WebSocket,
    readonly delegatedPrincipal: DelegatedPrincipal | undefined,
  ) {}

  async handle(raw: string): Promise<void> {
    let control: z.infer<typeof collaborationWsControlSchema>;
    try {
      control = collaborationWsControlSchema.parse(JSON.parse(raw));
    } catch (error) {
      this.send({
        type: 'error',
        code: ErrorCode.VALIDATION_FAILED,
        msg: 'invalid collaboration websocket message',
        details: error instanceof z.ZodError
          ? error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
          : undefined,
      });
      return;
    }

    if (!this.core.accessor.get(IFlagService).enabled('platform_services')) {
      this.sendAck(control.request_id, ErrorCode.PLATFORM_DISABLED, 'platform services are disabled', null);
      return;
    }

    try {
      if (control.type === 'subscribe') {
        await this.subscribe(control);
      } else if (this.workspaceId === undefined || this.channelId === undefined) {
        this.sendAck(control.request_id, ErrorCode.VALIDATION_FAILED, 'subscribe before replay', null);
      } else {
        this.requestId = control.request_id;
        await this.replay(control.after_sequence ?? this.cursor, control.request_id, control.limit);
      }
    } catch (error) {
      const mapped = mapCollaborationError(error);
      this.sendAck(control.request_id, mapped.code, mapped.message, null);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.pollTimer !== undefined) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  private async subscribe(
    control: Extract<z.infer<typeof collaborationWsControlSchema>, { type: 'subscribe' }>,
  ): Promise<void> {
    this.workspaceId = control.workspace_id;
    this.channelId = control.channel_id;
    this.threadId = control.thread_id;
    this.requestId = control.request_id;
    this.cursor = control.after_sequence ?? 0;
    this.limit = control.limit ?? DEFAULT_LIMIT;
    await this.replay(this.cursor, control.request_id, this.limit);
    this.pollTimer ??= setInterval(() => {
      void runWithRequestDelegatedPrincipal(this.delegatedPrincipal, () => this.poll());
    }, POLL_INTERVAL_MS);
  }

  private async replay(afterSequence: number, requestId: string, limit = this.limit): Promise<void> {
    const workspaceId = this.workspaceId;
    const channelId = this.channelId;
    if (workspaceId === undefined || channelId === undefined || this.disposed) return;
    const page = await this.collaboration.listMessages(workspaceId, channelId, requestId, {
      afterSequence,
      limit: limit ?? DEFAULT_LIMIT,
      threadId: this.threadId,
    });
    this.applyPage(page);
    this.sendAck(requestId, ErrorCode.SUCCESS, 'ok', page);
    this.sendMessages(page);
  }

  private async poll(): Promise<void> {
    if (
      this.disposed ||
      this.polling ||
      this.workspaceId === undefined ||
      this.channelId === undefined ||
      this.requestId === undefined
    ) return;
    this.polling = true;
    try {
      const page = await this.collaboration.listMessages(
        this.workspaceId,
        this.channelId,
        this.requestId,
        {
          afterSequence: this.cursor,
          limit: this.limit,
          threadId: this.threadId,
        },
      );
      if (page.items.length > 0) {
        this.applyPage(page);
        this.sendMessages(page);
      }
    } catch (error) {
      // The durable REST surface remains the recovery path. Keep the socket
      // alive for transient persistence/authorization races, but report the
      // failure so the browser can decide when to fall back to REST.
      const mapped = mapCollaborationError(error);
      this.sendAck(this.requestId, mapped.code, mapped.message, null);
    } finally {
      this.polling = false;
    }
  }

  private applyPage(page: CollaborationMessagePage): void {
    const lastMessage = page.items.at(-1);
    const lastSequence = lastMessage === undefined
      ? undefined
      : (lastMessage.event_sequence ?? lastMessage.sequence);
    if (lastSequence !== undefined) this.cursor = Math.max(this.cursor, lastSequence);
    if (page.next_cursor !== undefined) this.cursor = Math.max(this.cursor, Number(page.next_cursor));
  }

  private sendMessages(page: CollaborationMessagePage): void {
    for (const message of page.items) this.send({ type: 'collaboration_message', message });
  }

  private sendAck(
    requestId: string,
    code: number,
    msg: string,
    data: CollaborationMessagePage | null,
  ): void {
    this.send({ type: 'ack', request_id: requestId, code, msg, data });
  }

  private send(value: unknown): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(value));
  }
}

function mapCollaborationError(error: unknown): { readonly code: number; readonly message: string } {
  if (error instanceof CollaborationError) {
    if (error.kind === 'workspace_not_found') return { code: ErrorCode.WORKSPACE_NOT_FOUND, message: 'workspace not found' };
    if (error.kind === 'forbidden') return { code: ErrorCode.PLATFORM_POLICY_DENIED, message: 'platform policy denied the request' };
    if (error.kind === 'not_found') return { code: ErrorCode.PLATFORM_RESOURCE_NOT_FOUND, message: 'collaboration resource not found' };
    if (error.kind === 'conflict') return { code: ErrorCode.PLATFORM_CONFLICT, message: 'collaboration state conflicts with the request' };
    return { code: ErrorCode.INTERNAL_ERROR, message: 'collaboration request failed' };
  }
  return { code: ErrorCode.INTERNAL_ERROR, message: 'collaboration request failed' };
}
