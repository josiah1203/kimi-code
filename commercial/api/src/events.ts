import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';

import type { FastifyInstance } from 'fastify';
import { WebSocket, WebSocketServer } from 'ws';

import {
  assertSafeMetadata,
  isoDateTimeSchema,
  organizationIdSchema,
  workspaceIdSchema,
  type OrganizationId,
  type Principal,
  type WorkspaceId,
} from '@spiderbyte/commercial-domain';
import type { CommercialDirectoryService } from '@spiderbyte/commercial-application';

import { mapCommercialApiError } from './errors';
import type { CommercialApiError } from './errors';
import { CommercialAuthMiddleware } from './auth';

export interface CommercialRealtimeEvent {
  readonly id: string;
  readonly organization_id: OrganizationId;
  readonly workspace_id?: WorkspaceId;
  readonly type: string;
  readonly occurred_at: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface CommercialRealtimeEventInput {
  readonly organization_id: string;
  readonly workspace_id?: string;
  readonly type: string;
  readonly occurred_at: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

interface Subscriber {
  readonly principal: Principal;
  readonly organization_id: OrganizationId;
  readonly workspace_id: WorkspaceId | undefined;
  readonly handler: (event: CommercialRealtimeEvent) => void;
}

export class InProcessCommercialEventHub {
  private sequence = 0;
  private readonly subscribers = new Map<number, Subscriber>();

  publish(input: CommercialRealtimeEventInput): CommercialRealtimeEvent {
    const event: CommercialRealtimeEvent = {
      id: `event_${randomUUID().replaceAll('-', '')}_${(this.sequence += 1).toString(36)}`,
      organization_id: organizationIdSchema.parse(input.organization_id),
      workspace_id: input.workspace_id === undefined ? undefined : workspaceIdSchema.parse(input.workspace_id),
      type: input.type,
      occurred_at: isoDateTimeSchema.parse(input.occurred_at),
      payload: structuredClone(input.payload),
    };
    assertSafeMetadata(input.payload as Record<string, unknown>);
    for (const subscriber of this.subscribers.values()) {
      if (subscriber.organization_id !== event.organization_id) continue;
      if (subscriber.workspace_id !== undefined && subscriber.workspace_id !== event.workspace_id) continue;
      subscriber.handler(structuredClone(event));
    }
    return event;
  }

  subscribe(input: {
    readonly principal: Principal;
    readonly organization_id: string;
    readonly workspace_id?: string;
    readonly handler: (event: CommercialRealtimeEvent) => void;
  }): { close(): void } {
    const organization_id = organizationIdSchema.parse(input.organization_id);
    const workspace_id = input.workspace_id === undefined ? undefined : workspaceIdSchema.parse(input.workspace_id);
    const id = ++this.sequence;
    this.subscribers.set(id, { ...input, organization_id, workspace_id });
    return { close: () => this.subscribers.delete(id) };
  }
}

export interface CommercialWebSocketDependencies {
  readonly auth: CommercialAuthMiddleware;
  readonly directory: CommercialDirectoryService;
  readonly events: InProcessCommercialEventHub;
  readonly path?: string;
}

/**
 * Attaches a hosted-only WebSocket endpoint to a Fastify server. Open Core
 * never calls this function. Authentication and organization authorization are
 * completed during the HTTP upgrade before a socket is accepted.
 */
export function attachCommercialWebSocket(
  app: FastifyInstance,
  dependencies: CommercialWebSocketDependencies,
): { close(): Promise<void> } {
  const path = dependencies.path ?? '/api/v1/commercial/events';
  const server = new WebSocketServer({ noServer: true });
  const onUpgrade = async (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const parsed = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (parsed.pathname !== path) return;
    const request_id = headerValue(request.headers['x-request-id']) ?? `req_${randomUUID().replaceAll('-', '')}`;
    const organization_id = parsed.searchParams.get('organization_id');
    const workspace_id = parsed.searchParams.get('workspace_id') ?? undefined;
    if (organization_id === null) {
      rejectUpgrade(socket, 400, request_id, 'commercial.organization_required', 'organization_id is required');
      return;
    }
    try {
      const context = await dependencies.auth.authenticate({ request_id, headers: request.headers });
      await dependencies.directory.assertAuthorized(context.principal, organization_id, 'organization.read', request_id, workspace_id);
      server.handleUpgrade(request, socket, head, (client) => {
        const subscription = dependencies.events.subscribe({
          principal: context.principal,
          organization_id,
          workspace_id,
          handler: (event) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'event', data: event }));
            }
          },
        });
        client.send(JSON.stringify({ type: 'connected', request_id, organization_id, workspace_id }));
        client.once('close', () => {
          subscription.close();
        });
      });
    } catch (error) {
      const mapped = mapCommercialApiError(error);
      rejectUpgrade(socket, mapped.status, request_id, mapped.code, mapped.message);
    }
  };
  const onUpgradeListener = (request: IncomingMessage, socket: Socket, head: Buffer): void => {
    void onUpgrade(request, socket, head);
  };
  app.server.on('upgrade', onUpgradeListener);
  return {
    close: async () => {
      app.server.removeListener('upgrade', onUpgradeListener);
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function rejectUpgrade(socket: Socket, status: CommercialApiError['status'], request_id: string, code: string, message: string): void {
  const body = JSON.stringify({ request_id, error: { code, message } });
  socket.write(`HTTP/1.1 ${status} Error\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
  socket.destroy();
}
