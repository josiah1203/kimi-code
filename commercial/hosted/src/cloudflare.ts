import { Client } from 'pg';

import {
  assertSafeMetadata,
  capabilityStatusSchema,
  nowIsoDateTime,
  type CapabilityStatus,
  type OrganizationId,
  type WorkspaceId,
} from '@spiderbyte/commercial-domain';
import {
  CapabilityUnavailableError,
  type ArtifactObject,
  type ArtifactStore,
  type CommercialStore,
  type EventBus,
  type EventEnvelope,
  type EventHistoryStore,
  type HostedArtifactAdapter,
  type ObservabilityProvider,
  type SecretsProvider,
  type WorkflowEngine,
  type WorkflowRun,
} from '@spiderbyte/commercial-ports';
import {
  SqlCommercialDatabaseAdapter,
  type CommercialSqlClient,
  type CommercialSqlQueryResult,
} from '@spiderbyte/commercial-persistence';

export interface HyperdriveBinding {
  readonly connectionString: string;
}

export class HyperdriveSqlClient implements CommercialSqlClient {
  constructor(private readonly binding: HyperdriveBinding) {}

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<CommercialSqlQueryResult<Row>> {
    return this.withClient(async (client) => {
      const result = await client.query<Row>(sql, [...parameters]);
      return {
        rows: result.rows,
        ...(result.rowCount === null ? undefined : { rowCount: result.rowCount }),
      };
    });
  }

  async transaction<T>(operation: (client: CommercialSqlClient) => Promise<T>): Promise<T> {
    return this.withClient(async (client) => {
      await client.query('BEGIN');
      const transactionClient: CommercialSqlClient = {
        query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
          sql: string,
          parameters: readonly unknown[] = [],
        ): Promise<CommercialSqlQueryResult<Row>> => {
          const result = await client.query<Row>(sql, [...parameters]);
          return {
            rows: result.rows,
            ...(result.rowCount === null ? undefined : { rowCount: result.rowCount }),
          };
        },
        transaction: async () => {
          throw new Error('nested commercial SQL transactions are not supported');
        },
      };
      try {
        const result = await operation(transactionClient);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    });
  }

  private async withClient<T>(operation: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: this.binding.connectionString });
    await client.connect();
    try {
      return await operation(client);
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}

export class CloudflareHyperdriveDatabaseAdapter extends SqlCommercialDatabaseAdapter {
  private readonly configured: boolean;

  constructor(binding: HyperdriveBinding | undefined, clock: { now(): string } = { now: nowIsoDateTime }) {
    super(binding === undefined || binding.connectionString.length === 0 ? undefined : new HyperdriveSqlClient(binding), clock);
    this.configured = binding !== undefined && binding.connectionString.length > 0;
  }

  override capability(): CapabilityStatus {
    return capabilityStatusSchema.parse({
      capability: 'hosted_database',
      availability: this.configured ? 'available' : 'not_configured',
      adapter: 'cloudflare-hyperdrive-postgresql',
      reason: this.configured
        ? 'Cloudflare Hyperdrive supplies a pooled PostgreSQL connection to the commercial SQL store'
        : 'HYPERDRIVE is not bound or has no connection string',
      checked_at: nowIsoDateTime(),
    });
  }
}

export interface R2BucketBinding {
  head(key: string): Promise<R2ObjectLike | null>;
  get(key: string): Promise<R2ObjectLike | null>;
  put(key: string, value: ArrayBuffer | ArrayBufferView | ReadableStream<Uint8Array>, options?: R2PutOptionsLike): Promise<R2ObjectLike | null>;
  delete(key: string): Promise<void>;
}

interface R2ObjectLike {
  readonly body?: ReadableStream<Uint8Array>;
  readonly size?: number;
  readonly httpMetadata?: { readonly contentType?: string };
  readonly customMetadata?: Readonly<Record<string, string>>;
}

interface R2PutOptionsLike {
  readonly httpMetadata?: { readonly contentType?: string };
  readonly customMetadata?: Readonly<Record<string, string>>;
}

export interface ArtifactDownloadSigner {
  sign(input: {
    readonly organization_id: OrganizationId;
    readonly workspace_id: WorkspaceId;
    readonly artifact_id: string;
    readonly expires_at: string;
  }): Promise<string>;
}

export class CloudflareR2ArtifactStore implements ArtifactStore, HostedArtifactAdapter {
  readonly adapter_name = 'cloudflare-r2';

  constructor(
    private readonly bucket: R2BucketBinding | undefined,
    private readonly signer?: ArtifactDownloadSigner,
  ) {}

  capability(): CapabilityStatus {
    return capabilityStatusSchema.parse({
      capability: 'hosted_artifacts',
      availability: this.bucket === undefined ? 'not_configured' : 'available',
      adapter: this.adapter_name,
      reason: this.bucket === undefined
        ? 'ARTIFACTS R2 binding is not configured'
        : 'artifacts are stored in tenant-scoped, content-addressed R2 keys',
      checked_at: nowIsoDateTime(),
    });
  }

  async putObject(input: {
    readonly account_id?: string;
    readonly organization_id: OrganizationId;
    readonly workspace_id: WorkspaceId;
    readonly object_id: string;
    readonly content_address: string;
    readonly media_type?: string;
    readonly metadata?: Readonly<Record<string, string>>;
    readonly bytes: Uint8Array;
  }): Promise<{ readonly object_ref: string; readonly size_bytes: number }> {
    const bucket = this.requireBucket();
    if (!/^sha256:[a-f0-9]{64}$/u.test(input.content_address)) throw new Error('artifact content address must be a lowercase sha256 digest');
    const actualContentAddress = `sha256:${await sha256Hex(input.bytes)}`;
    if (actualContentAddress !== input.content_address) throw new Error('artifact content address does not match the uploaded bytes');
    const key = objectKey(input.organization_id, input.workspace_id, input.object_id, input.content_address);
    const metadata = {
      ...(input.metadata ?? {}),
      spiderbyte_account_id: input.account_id ?? '',
      spiderbyte_organization_id: input.organization_id,
      spiderbyte_workspace_id: input.workspace_id,
      spiderbyte_content_address: input.content_address,
    };
    assertSafeMetadata(metadata);
    await bucket.put(key, input.bytes, {
      httpMetadata: { contentType: input.media_type ?? 'application/octet-stream' },
      customMetadata: metadata,
    });
    return { object_ref: `r2:${key}`, size_bytes: input.bytes.byteLength };
  }

  async getObject(input: {
    readonly organization_id: OrganizationId;
    readonly workspace_id: WorkspaceId;
    readonly object_ref: string;
  }): Promise<ArtifactObject | undefined> {
    const bucket = this.requireBucket();
    const key = scopedObjectKey(input.organization_id, input.workspace_id, input.object_ref);
    const object = await bucket.get(key);
    if (object === null || object.body === undefined) return undefined;
    return {
      object_ref: input.object_ref,
      content_address: object.customMetadata?.['spiderbyte_content_address'] ?? 'unknown',
      media_type: object.httpMetadata?.contentType,
      size_bytes: object.size ?? 0,
      metadata: object.customMetadata ?? {},
      body: object.body,
    };
  }

  async deleteObject(input: {
    readonly organization_id: OrganizationId;
    readonly workspace_id: WorkspaceId;
    readonly object_ref: string;
  }): Promise<void> {
    const bucket = this.requireBucket();
    await bucket.delete(scopedObjectKey(input.organization_id, input.workspace_id, input.object_ref));
  }

  async put(input: {
    readonly artifact_id: string;
    readonly organization_id: OrganizationId;
    readonly workspace_id: WorkspaceId;
    readonly content_address: string;
    readonly bytes: Uint8Array;
    readonly request_id: string;
  }): Promise<{ readonly object_ref: string }> {
    const result = await this.putObject({
      organization_id: input.organization_id,
      workspace_id: input.workspace_id,
      object_id: input.artifact_id,
      content_address: input.content_address,
      bytes: input.bytes,
      metadata: { spiderbyte_request_id: input.request_id },
    });
    return { object_ref: result.object_ref };
  }

  async delete(input: {
    readonly organization_id: OrganizationId;
    readonly workspace_id: WorkspaceId;
    readonly object_ref: string;
    readonly request_id: string;
  }): Promise<void> {
    await this.deleteObject(input);
  }

  async issueDownload(input: {
    readonly organization_id: OrganizationId;
    readonly workspace_id: WorkspaceId;
    readonly artifact_id: string;
    readonly expires_at: string;
  }): Promise<{ readonly url: string; readonly expires_at: string }> {
    if (this.signer === undefined) {
      throw new CapabilityUnavailableError(capabilityStatusSchema.parse({
        capability: 'hosted_artifacts',
        availability: 'not_configured',
        adapter: this.adapter_name,
        reason: 'artifact download signing is not configured',
        checked_at: nowIsoDateTime(),
      }));
    }
    return {
      url: await this.signer.sign(input),
      expires_at: input.expires_at,
    };
  }

  private requireBucket(): R2BucketBinding {
    if (this.bucket === undefined) throw new CapabilityUnavailableError(this.capability());
    return this.bucket;
  }
}

export interface QueueBinding {
  send(body: unknown, options?: { readonly contentType?: 'json' | 'text' | 'bytes' | 'v8' }): Promise<unknown>;
}

export class CloudflareQueueEventBus implements EventBus {
  readonly adapter_name = 'cloudflare-queues';

  constructor(private readonly queue: QueueBinding | undefined) {}

  capability(): CapabilityStatus {
    return capabilityStatusSchema.parse({
      capability: 'event_bus',
      availability: this.queue === undefined ? 'not_configured' : 'available',
      adapter: this.adapter_name,
      reason: this.queue === undefined ? 'queue binding is not configured' : 'events are durably published to Cloudflare Queues',
      checked_at: nowIsoDateTime(),
    });
  }

  async publish(event: EventEnvelope): Promise<{ readonly event_id: string }> {
    if (this.queue === undefined) throw new CapabilityUnavailableError(this.capability());
    assertSafeMetadata(event.payload);
    const size = new TextEncoder().encode(JSON.stringify(event)).byteLength;
    if (size > 128 * 1024) throw new RangeError('event exceeds the Cloudflare Queue message limit');
    await this.queue.send(event, { contentType: 'json' });
    return { event_id: event.event_id };
  }
}

export class CloudflareEventHistoryStore implements EventHistoryStore {
  readonly adapter_name = 'cloudflare-hyperdrive-event-history';

  constructor(private readonly client: CommercialSqlClient | undefined) {}

  capability(): CapabilityStatus {
    return capabilityStatusSchema.parse({
      capability: 'hosted_database',
      availability: this.client === undefined ? 'not_configured' : 'available',
      adapter: this.adapter_name,
      reason: this.client === undefined
        ? 'Hyperdrive SQL client is not configured for event history'
        : 'event history is appended to PostgreSQL before live Durable Object delivery',
      checked_at: nowIsoDateTime(),
    });
  }

  async append(event: EventEnvelope): Promise<EventEnvelope & { readonly sequence: number }> {
    const client = this.requireClient();
    assertSafeMetadata(event.payload);
    await client.query(
      `INSERT INTO commercial_event_log
        (event_id, account_id, organization_id, workspace_id, type, occurred_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (event_id) DO NOTHING`,
      [event.event_id, event.account_id ?? null, event.organization_id, event.workspace_id ?? null, event.type, event.occurred_at, JSON.stringify(event.payload)],
    );
    const result = await client.query<EventHistoryRow>(
      `SELECT sequence, event_id, account_id, organization_id, workspace_id, type, occurred_at, payload
       FROM commercial_event_log WHERE event_id = $1`,
      [event.event_id],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('event history append did not return a stored row');
    return rowToEvent(row);
  }

  async replay(input: {
    readonly organization_id: OrganizationId;
    readonly workspace_id?: WorkspaceId;
    readonly after_sequence?: number;
    readonly limit?: number;
  }): Promise<readonly (EventEnvelope & { readonly sequence: number })[]> {
    const client = this.requireClient();
    const limit = Number.isSafeInteger(input.limit) && Number(input.limit) > 0 ? Math.min(Number(input.limit), 500) : 100;
    const after = Number.isSafeInteger(input.after_sequence) && Number(input.after_sequence) >= 0 ? Number(input.after_sequence) : 0;
    const result = await client.query<EventHistoryRow>(
      `SELECT sequence, event_id, account_id, organization_id, workspace_id, type, occurred_at, payload
       FROM commercial_event_log
       WHERE organization_id = $1
         AND ($2::text IS NULL OR workspace_id = $2)
         AND sequence > $3
       ORDER BY sequence ASC LIMIT $4`,
      [input.organization_id, input.workspace_id ?? null, after, limit],
    );
    return result.rows.map(rowToEvent);
  }

  private requireClient(): CommercialSqlClient {
    if (this.client === undefined) throw new CapabilityUnavailableError(this.capability());
    return this.client;
  }
}

interface EventHistoryRow extends Record<string, unknown> {
  readonly sequence: number;
  readonly event_id: string;
  readonly account_id?: string | null;
  readonly organization_id: string;
  readonly workspace_id?: string | null;
  readonly type: string;
  readonly occurred_at: string;
  readonly payload: unknown;
}

function rowToEvent(row: EventHistoryRow): EventEnvelope & { readonly sequence: number } {
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) as unknown : row.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new Error('stored event payload is malformed');
  return {
    event_id: row.event_id,
    account_id: row.account_id ?? undefined,
    organization_id: row.organization_id as OrganizationId,
    workspace_id: row.workspace_id ?? undefined,
    type: row.type,
    sequence: Number(row.sequence),
    occurred_at: row.occurred_at,
    payload: payload as Readonly<Record<string, unknown>>,
  };
}

export interface WorkflowBinding {
  create(input: { readonly id: string; readonly params: Readonly<Record<string, unknown>> }): Promise<WorkflowInstanceBinding>;
  get(id: string): Promise<WorkflowInstanceBinding>;
}

export interface WorkflowInstanceBinding {
  readonly id: string;
  status(): Promise<unknown>;
  terminate(): Promise<void>;
}

export class CloudflareWorkflowAdapter implements WorkflowEngine {
  readonly adapter_name = 'cloudflare-workflows';

  constructor(private readonly bindings: Readonly<Record<string, WorkflowBinding | undefined>>) {}

  capability(): CapabilityStatus {
    const configured = Object.values(this.bindings).some((binding) => binding !== undefined);
    return capabilityStatusSchema.parse({
      capability: 'workflow_engine',
      availability: configured ? 'available' : 'not_configured',
      adapter: this.adapter_name,
      reason: configured ? 'durable workflow bindings are configured' : 'no workflow binding is configured',
      checked_at: nowIsoDateTime(),
    });
  }

  async start(input: {
    readonly workflow_name: string;
    readonly id: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }): Promise<WorkflowRun> {
    const workflow = this.bindings[input.workflow_name];
    if (workflow === undefined) throw new CapabilityUnavailableError(this.capability());
    const instance = await workflow.create({ id: input.id, params: input.payload });
    return { id: instance.id, workflow_name: input.workflow_name, state: 'queued' };
  }

  async inspect(workflowName: string, id: string): Promise<WorkflowRun> {
    const workflow = this.bindings[workflowName];
    if (workflow === undefined) throw new CapabilityUnavailableError(this.capability());
    const instance = await workflow.get(id);
    return { id: instance.id, workflow_name: workflowName, state: workflowState(await instance.status()) };
  }

  async terminate(workflowName: string, id: string): Promise<void> {
    const workflow = this.bindings[workflowName];
    if (workflow === undefined) throw new CapabilityUnavailableError(this.capability());
    await (await workflow.get(id)).terminate();
  }
}

export class UnavailableSecretsProvider implements SecretsProvider {
  readonly adapter_name = 'unavailable-secrets';

  capability(): CapabilityStatus {
    return capabilityStatusSchema.parse({
      capability: 'secrets',
      availability: 'not_configured',
      adapter: this.adapter_name,
      reason: 'a customer-managed secret store or Cloudflare Secrets Store adapter is required',
      checked_at: nowIsoDateTime(),
    });
  }

  async resolve(_input: {
    readonly organization_id: OrganizationId;
    readonly secret_ref: string;
    readonly purpose: string;
  }): Promise<{ readonly value: string; readonly expires_at?: string }> {
    throw new CapabilityUnavailableError(this.capability());
  }
}

export class CloudflareObservabilityProvider implements ObservabilityProvider {
  readonly adapter_name = 'cloudflare-observability';

  capability(): CapabilityStatus {
    return capabilityStatusSchema.parse({
      capability: 'observability',
      availability: 'available',
      adapter: this.adapter_name,
      reason: 'structured Worker logs are emitted for Cloudflare observability',
      checked_at: nowIsoDateTime(),
    });
  }

  async record(input: {
    readonly level: 'debug' | 'info' | 'warn' | 'error';
    readonly event: string;
    readonly request_id?: string;
    readonly organization_id?: OrganizationId;
    readonly attributes?: Readonly<Record<string, string | number | boolean>>;
  }): Promise<void> {
    const record = JSON.stringify({
      event: input.event,
      request_id: input.request_id,
      organization_id: input.organization_id,
      attributes: input.attributes,
      recorded_at: nowIsoDateTime(),
    });
    switch (input.level) {
      case 'debug': console.debug(record); break;
      case 'info': console.info(record); break;
      case 'warn': console.warn(record); break;
      case 'error': console.error(record); break;
    }
  }
}

function objectKey(organizationId: string, workspaceId: string, objectId: string, contentAddress: string): string {
  const digest = contentAddress.match(/^sha256:([a-f0-9]{64})$/i)?.[1];
  if (digest === undefined) throw new Error('artifact content address must be a SHA-256 digest');
  return `tenants/${safeSegment(organizationId)}/${safeSegment(workspaceId)}/objects/${safeSegment(objectId)}/sha256/${digest.toLowerCase()}`;
}

function scopedObjectKey(organizationId: string, workspaceId: string, objectRef: string): string {
  const prefix = 'r2:';
  if (!objectRef.startsWith(prefix)) throw new Error('artifact object reference is not an R2 reference');
  const key = objectRef.slice(prefix.length);
  const expectedPrefix = `tenants/${safeSegment(organizationId)}/${safeSegment(workspaceId)}/`;
  if (!key.startsWith(expectedPrefix) || key.includes('..') || key.includes('\\')) {
    throw new Error('artifact object reference is outside the requested tenant scope');
  }
  return key;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copy.buffer));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9_.:-]+$/.test(value) || value === '.' || value === '..') {
    throw new Error('artifact path segment is invalid');
  }
  return value;
}

function workflowState(value: unknown): string {
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
  const state = record?.['status'] ?? record?.['state'];
  return typeof state === 'string' ? state : 'unknown';
}
