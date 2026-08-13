import { DurableObject } from 'cloudflare:workers';

import type { EventEnvelope } from '@spiderbyte/commercial-ports';

import { asRecord, parseEventEnvelope } from './validation';

interface EventAttachment {
  readonly organization_id: string;
  readonly workspace_id?: string;
  readonly after_sequence: number;
}

interface StoredEvent {
  readonly sequence: number;
  readonly event_id: string;
  readonly account_id?: string;
  readonly organization_id: string;
  readonly workspace_id?: string;
  readonly type: string;
  readonly occurred_at: string;
  readonly payload: string;
}

export class RunEventsDurableObject extends DurableObject {
  private readonly sql: DurableObjectState['storage']['sql'];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS run_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        account_id TEXT,
        organization_id TEXT NOT NULL,
        workspace_id TEXT,
        type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS run_events_scope_idx
        ON run_events (organization_id, workspace_id, sequence);
    `);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/publish') return this.publish(request);
    if (request.method === 'GET' && url.pathname === '/events') {
      return this.list(url);
    }
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      return this.openWebSocket(url);
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') {
      ws.send(JSON.stringify({ type: 'error', code: 'binary_messages_not_supported' }));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(message) as unknown;
    } catch {
      ws.send(JSON.stringify({ type: 'error', code: 'invalid_json' }));
      return;
    }
    const record = asRecord(parsed);
    if (record?.['type'] !== 'replay') {
      ws.send(JSON.stringify({ type: 'error', code: 'only_replay_is_supported' }));
      return;
    }
    const attachment = this.attachment(ws);
    const after = record['after'];
    const afterSequence = Number.isSafeInteger(after) ? Number(after) : attachment.after_sequence;
    await this.sendReplay(ws, attachment.organization_id, attachment.workspace_id, afterSequence);
  }

  override webSocketClose(ws: WebSocket, code: number, reason: string): void {
    ws.close(code, reason);
  }

  private async publish(request: Request): Promise<Response> {
    const event = parseEventEnvelope(await request.json());
    const existing = this.sql.exec(
      `SELECT sequence, event_id, account_id, organization_id, workspace_id, type, occurred_at, payload
       FROM run_events WHERE event_id = ?`,
      event.event_id,
    ).toArray()[0] as unknown as StoredEvent | undefined;
    if (existing !== undefined) return Response.json({ event_id: existing.event_id, sequence: existing.sequence, duplicate: true });
    this.sql.exec(
      `INSERT OR IGNORE INTO run_events
        (event_id, account_id, organization_id, workspace_id, type, occurred_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      event.event_id,
      event.account_id ?? null,
      event.organization_id,
      event.workspace_id ?? null,
      event.type,
      event.occurred_at,
      JSON.stringify(event.payload),
    );
    const row = this.sql.exec(
      `SELECT sequence, event_id, account_id, organization_id, workspace_id, type, occurred_at, payload
       FROM run_events WHERE event_id = ?`,
      event.event_id,
    ).toArray()[0] as StoredEvent | undefined;
    if (row === undefined) throw new Error('durable event insert did not return a stored row');
    const stored = toEvent(row);
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = this.attachment(ws);
      if (attachment.organization_id !== stored.organization_id) continue;
      if (attachment.workspace_id !== undefined && attachment.workspace_id !== stored.workspace_id) continue;
      if (stored.sequence <= attachment.after_sequence) continue;
      ws.send(JSON.stringify({ type: 'event', data: stored }));
      ws.serializeAttachment({ ...attachment, after_sequence: stored.sequence });
    }
    return Response.json({ event_id: stored.event_id, sequence: stored.sequence });
  }

  private list(url: URL): Response {
    const organizationId = url.searchParams.get('organization_id');
    if (organizationId === null) return Response.json({ error: 'organization_id_required' }, { status: 400 });
    const workspaceId = url.searchParams.get('workspace_id');
    const after = Number(url.searchParams.get('after') ?? '0');
    const rows = this.sql.exec(
      `SELECT sequence, event_id, account_id, organization_id, workspace_id, type, occurred_at, payload
       FROM run_events
       WHERE organization_id = ?
         AND (? IS NULL OR workspace_id = ?)
         AND sequence > ?
       ORDER BY sequence ASC LIMIT 500`,
      organizationId,
      workspaceId,
      workspaceId,
      Number.isSafeInteger(after) && after >= 0 ? after : 0,
    ).toArray() as unknown as StoredEvent[];
    return Response.json({ events: rows.map(toEvent), next_sequence: rows.at(-1)?.sequence ?? after });
  }

  private async openWebSocket(url: URL): Promise<Response> {
    const organizationId = url.searchParams.get('organization_id');
    if (organizationId === null) return Response.json({ error: 'organization_id_required' }, { status: 400 });
    const workspaceId = url.searchParams.get('workspace_id') ?? undefined;
    const afterValue = Number(url.searchParams.get('after') ?? '0');
    const after = Number.isSafeInteger(afterValue) && afterValue >= 0 ? afterValue : 0;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ organization_id: organizationId, workspace_id: workspaceId, after_sequence: after });
    await this.sendReplay(server, organizationId, workspaceId, after);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async sendReplay(ws: WebSocket, organizationId: string, workspaceId: string | undefined, after: number): Promise<void> {
    const rows = this.sql.exec(
      `SELECT sequence, event_id, account_id, organization_id, workspace_id, type, occurred_at, payload
       FROM run_events
       WHERE organization_id = ?
         AND (? IS NULL OR workspace_id = ?)
         AND sequence > ?
       ORDER BY sequence ASC LIMIT 500`,
      organizationId,
      workspaceId ?? null,
      workspaceId ?? null,
      after,
    ).toArray() as unknown as StoredEvent[];
    for (const row of rows) {
      ws.send(JSON.stringify({ type: 'event', data: toEvent(row), replay: true }));
      ws.serializeAttachment({ organization_id: organizationId, workspace_id: workspaceId, after_sequence: row.sequence });
    }
  }

  private attachment(ws: WebSocket): EventAttachment {
    const attachment = ws.deserializeAttachment();
    const record = asRecord(attachment);
    if (record === undefined || typeof record['organization_id'] !== 'string') {
      throw new Error('WebSocket event attachment is invalid');
    }
    return {
      organization_id: record['organization_id'],
      workspace_id: typeof record['workspace_id'] === 'string' ? record['workspace_id'] : undefined,
      after_sequence: typeof record['after_sequence'] === 'number' ? record['after_sequence'] : 0,
    };
  }
}

function toEvent(row: StoredEvent): EventEnvelope & { readonly sequence: number } {
  return {
    event_id: row.event_id,
    account_id: row.account_id as EventEnvelope['account_id'],
    organization_id: row.organization_id as EventEnvelope['organization_id'],
    workspace_id: row.workspace_id as EventEnvelope['workspace_id'],
    type: row.type,
    sequence: row.sequence,
    occurred_at: row.occurred_at,
    payload: JSON.parse(row.payload) as Readonly<Record<string, unknown>>,
  };
}
