/**
 * Durable workspace provider-connection registry.
 *
 * This service owns the platform connection projection, not the legacy
 * `IProviderService` registry and not a secret store. It stores only
 * `secret_*` references, persists mutations atomically, and makes command
 * retries idempotent by request id.
 */

import { ulid } from 'ulid';
import { z } from 'zod';

import { Disposable } from '#/_base/di/lifecycle';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { Emitter, type Event } from '#/_base/event';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import { IWorkspacePlatformEventService } from '#/workspace/platformEvents/platformEvents';
import {
  nowIsoDateTime,
  PLATFORM_NO_CREDENTIAL_SECRET_REF,
  providerConnectionCommandInputSchema,
  providerConnectionCreateInputSchema,
  providerConnectionSchema,
  providerConnectionUpdateInputSchema,
  providerModelDiscoverySchema,
  providerModelSchema,
  type ProviderConnection,
  type ProviderConnectionCommandInput,
  type ProviderConnectionCreateInput,
  type ProviderConnectionUpdateInput,
  type ProviderModelDiscovery,
} from '@spiderbyte/protocol';

import {
  IWorkspaceProviderConnectionService,
  type WorkspaceProviderConnectionsChangedEvent,
} from './providerConnection';
import {
  ProviderConnectionErrors,
  ProviderConnectionError,
  ProviderConnectionSecretError,
} from './errors';

const CONNECTIONS_KEY = 'provider-connections.json';
const DOCUMENT_VERSION = 1;

const connectionsDocumentSchema = z.strictObject({
  version: z.literal(DOCUMENT_VERSION),
  connections: z.array(providerConnectionSchema),
  requests: z.record(z.string(), z.string()).default({}),
});

type ConnectionsDocument = z.infer<typeof connectionsDocumentSchema>;

const unsafeMetadataKey = /(?:api.?key|access.?token|refresh.?token|token(?!_ref)|password|private.?key|authorization|credential(?!_ref)|secret(?!_ref)|cookie)/i;

export class WorkspaceProviderConnectionService
  extends Disposable
  implements IWorkspaceProviderConnectionService
{
  declare readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  readonly onDidChange: Event<WorkspaceProviderConnectionsChangedEvent>;

  private readonly changes = this._register(new Emitter<WorkspaceProviderConnectionsChangedEvent>());
  private readonly scope: string;
  private connections: readonly ProviderConnection[] = [];
  private requests: Record<string, string> = {};
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    @IAtomicDocumentStore private readonly store: IAtomicDocumentStore,
    @IWorkspaceContext private readonly context: IWorkspaceContext,
    @IWorkspacePlatformEventService private readonly events: IWorkspacePlatformEventService,
  ) {
    super();
    this.scope = `${context.persistenceScope}/platform`;
    this.onDidChange = this.changes.event;
    this.ready = this.load();
  }

  async list(): Promise<readonly ProviderConnection[]> {
    await this.ready;
    return [...this.connections];
  }

  async get(id: string): Promise<ProviderConnection | undefined> {
    await this.ready;
    return this.connections.find((connection) => connection.id === id);
  }

  async create(input: ProviderConnectionCreateInput): Promise<ProviderConnection> {
    const command = providerConnectionCreateInputSchema.parse(input);
    assertCredentialReference(command.provider, command.secret_ref);
    assertSecretSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const existingId = this.requests[command.request_id];
      if (existingId !== undefined) {
        const existing = this.connections.find((connection) => connection.id === existingId);
        if (existing !== undefined) return existing;
      }
      if (this.connections.some((connection) => connection.name === command.name)) {
        throw new ProviderConnectionError(
          ProviderConnectionErrors.codes.PROVIDER_CONNECTION_NAME_TAKEN,
          `provider connection name already exists: ${command.name}`,
          { name: command.name },
        );
      }

      const now = nowIsoDateTime();
      const { request_id: _requestId, ...inputWithoutRequest } = command;
      const connection = providerConnectionSchema.parse({
        ...inputWithoutRequest,
        id: `conn_${ulid()}`,
        workspace_id: this.context.workspaceId,
        state: 'configured',
        created_at: now,
        updated_at: now,
      });
      await this.replace([...this.connections, connection], {
        ...this.requests,
        [command.request_id]: connection.id,
      });
      await this.events.append({
        event_type: 'provider_connection.created',
        entity_type: 'provider_connection',
        entity_id: connection.id,
        request_id: command.request_id,
        actor: 'user',
        state: connection.state,
        payload: { provider: connection.provider, scope: connection.scope },
      });
      this.changes.fire({ connection, kind: 'created' });
      return connection;
    });
  }

  async update(
    id: string,
    input: ProviderConnectionUpdateInput,
  ): Promise<ProviderConnection | undefined> {
    const command = providerConnectionUpdateInputSchema.parse(input);
    assertSecretSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const current = this.require(id);
      const previousRequest = this.requests[command.request_id];
      if (previousRequest !== undefined) return this.require(previousRequest);
      if (current.state === 'revoked') {
        throw new ProviderConnectionError(
          ProviderConnectionErrors.codes.PROVIDER_CONNECTION_REVOKED,
          `provider connection is revoked: ${id}`,
          { id },
        );
      }
      if (command.secret_ref !== undefined) {
        assertCredentialReference(current.provider, command.secret_ref);
      }
      const secretChanged =
        command.secret_ref !== undefined && command.secret_ref !== current.secret_ref;
      const { request_id: _requestId, ...patch } = command;
      const next = providerConnectionSchema.parse({
        ...current,
        ...patch,
        ...(secretChanged
          ? { state: 'configured', validated_at: undefined, revoked_at: undefined }
          : {}),
        updated_at: nowIsoDateTime(),
      });
      await this.replace(
        this.connections.map((connection) => (connection.id === id ? next : connection)),
        { ...this.requests, [command.request_id]: id },
      );
      await this.events.append({
        event_type: 'provider_connection.updated',
        entity_type: 'provider_connection',
        entity_id: id,
        request_id: command.request_id,
        actor: 'user',
        state: next.state,
      });
      this.changes.fire({ connection: next, kind: 'updated' });
      return next;
    });
  }

  async validate(
    id: string,
    input: ProviderConnectionCommandInput,
  ): Promise<ProviderConnection | undefined> {
    return this.transition(id, providerConnectionCommandInputSchema.parse(input), 'validated');
  }

  async activate(
    id: string,
    input: ProviderConnectionCommandInput,
  ): Promise<ProviderConnection | undefined> {
    return this.transition(id, providerConnectionCommandInputSchema.parse(input), 'activated');
  }

  async revoke(
    id: string,
    input: ProviderConnectionCommandInput,
  ): Promise<ProviderConnection | undefined> {
    return this.transition(id, providerConnectionCommandInputSchema.parse(input), 'revoked');
  }

  async discoverModels(id: string): Promise<ProviderModelDiscovery | undefined> {
    await this.ready;
    const connection = this.connections.find((candidate) => candidate.id === id);
    if (connection === undefined) return undefined;
    const rawModels = connection.metadata?.['models'];
    const models = Array.isArray(rawModels)
      ? rawModels.flatMap((raw) => {
          if (typeof raw === 'string') {
            return [{ id: raw, capabilities: [] }];
          }
          const parsed = providerModelSchema.safeParse(raw);
          return parsed.success ? [parsed.data] : [];
        })
      : [];
    return providerModelDiscoverySchema.parse({
      connection_id: id,
      models,
      discovered_at: nowIsoDateTime(),
    });
  }

  private async transition(
    id: string,
    command: ProviderConnectionCommandInput,
    kind: 'validated' | 'activated' | 'revoked',
  ): Promise<ProviderConnection | undefined> {
    return this.enqueue(async () => {
      await this.ready;
      const current = this.require(id);
      const previousRequest = this.requests[command.request_id];
      if (previousRequest !== undefined) return this.require(previousRequest);

      if (kind === 'validated' && current.state === 'revoked') {
        throw new ProviderConnectionError(
          ProviderConnectionErrors.codes.PROVIDER_CONNECTION_REVOKED,
          `provider connection is revoked: ${id}`,
          { id },
        );
      }
      if (kind === 'activated' && current.state !== 'validated' && current.state !== 'active') {
        throw new ProviderConnectionError(
          ProviderConnectionErrors.codes.PROVIDER_CONNECTION_INVALID_STATE,
          `provider connection must be validated before activation: ${id}`,
          { id, state: current.state },
        );
      }
      if (kind === 'revoked' && current.state === 'revoked') return current;

      const now = nowIsoDateTime();
      const next = providerConnectionSchema.parse({
        ...current,
        state:
          kind === 'validated' ? 'validated' : kind === 'activated' ? 'active' : 'revoked',
        updated_at: now,
        ...(kind === 'validated' ? { validated_at: now } : {}),
        ...(kind === 'revoked' ? { revoked_at: now } : {}),
      });
      await this.replace(
        this.connections.map((connection) => (connection.id === id ? next : connection)),
        { ...this.requests, [command.request_id]: id },
      );
      await this.events.append({
        event_type: `provider_connection.${kind}`,
        entity_type: 'provider_connection',
        entity_id: id,
        request_id: command.request_id,
        actor: 'user',
        state: next.state,
      });
      this.changes.fire({ connection: next, kind });
      return next;
    });
  }

  private require(id: string): ProviderConnection {
    const connection = this.connections.find((candidate) => candidate.id === id);
    if (connection === undefined) {
      throw new ProviderConnectionError(
        ProviderConnectionErrors.codes.PROVIDER_CONNECTION_NOT_FOUND,
        `provider connection not found: ${id}`,
        { id },
      );
    }
    return connection;
  }

  private async load(): Promise<void> {
    const raw = await this.store.get<unknown>(this.scope, CONNECTIONS_KEY);
    if (raw === undefined) {
      await this.replace([], {});
      return;
    }
    const document = connectionsDocumentSchema.parse(raw);
    this.connections = document.connections;
    this.requests = document.requests;
  }

  private async replace(
    connections: readonly ProviderConnection[],
    requests: Record<string, string>,
  ): Promise<void> {
    const document: ConnectionsDocument = {
      version: DOCUMENT_VERSION,
      connections: [...connections],
      requests,
    };
    await this.store.set(this.scope, CONNECTIONS_KEY, document);
    this.connections = document.connections;
    this.requests = document.requests;
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

function assertSecretSafeMetadata(metadata: Readonly<Record<string, unknown>> | undefined): void {
  if (metadata === undefined) return;
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      const nextPath = path.length === 0 ? key : `${path}.${key}`;
      if (unsafeMetadataKey.test(key)) throw new ProviderConnectionSecretError(nextPath);
      visit(nested, nextPath);
    }
  };
  visit(metadata, 'metadata');
}

function assertCredentialReference(
  provider: ProviderConnection['provider'],
  reference: ProviderConnection['secret_ref'],
): void {
  if (reference === PLATFORM_NO_CREDENTIAL_SECRET_REF && provider !== 'local') {
    throw new ProviderConnectionError(
      ProviderConnectionErrors.codes.PROVIDER_CONNECTION_SECRET_MATERIAL,
      'only local provider connections may use the no-credential reference',
      { key: 'secret_ref', provider },
    );
  }
}

registerScopedService(
  LifecycleScope.Workspace,
  IWorkspaceProviderConnectionService,
  WorkspaceProviderConnectionService,
  ScopeActivation.OnScopeCreated,
  'providerConnections',
);
