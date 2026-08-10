/** Durable workspace-native resources and governed resource execution. */

import { ulid } from 'ulid';
import { z } from 'zod';

import { Disposable } from '#/_base/di/lifecycle';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { Emitter, type Event } from '#/_base/event';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import { IWorkspacePlatformEventService } from '#/workspace/platformEvents/platformEvents';
import { IWorkspacePolicyService } from '#/workspace/policy/policy';
import {
  nowIsoDateTime,
  resourceCreateInputSchema,
  resourceExecuteInputSchema,
  resourceExecutionSchema,
  resourceSchema,
  resourceUpdateInputSchema,
  type Resource,
  type ResourceCreateInput,
  type ResourceExecuteInput,
  type ResourceExecution,
  type ResourceType,
  type ResourceUpdateInput,
} from '@moonshot-ai/protocol';

import { IWorkspaceResourceService, type WorkspaceResourcesChangedEvent } from './resource';
import { ResourceErrors, ResourceServiceError } from './errors';

const RESOURCE_KEY = 'resources.json';
const DOCUMENT_VERSION = 1;

const resourceDocumentSchema = z.strictObject({
  version: z.literal(DOCUMENT_VERSION),
  resources: z.array(resourceSchema),
  executions: z.array(resourceExecutionSchema),
  requests: z.record(z.string(), z.string()).default({}),
});

type ResourceDocument = z.infer<typeof resourceDocumentSchema>;

const sensitiveKey = /(?:api.?key|access.?token|refresh.?token|token(?!_ref)|password|private.?key|authorization|credential(?!_ref)|secret(?!_ref)|cookie)/i;

export class WorkspaceResourceService extends Disposable implements IWorkspaceResourceService {
  declare readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  readonly onDidChange: Event<WorkspaceResourcesChangedEvent>;

  private readonly changes = this._register(new Emitter<WorkspaceResourcesChangedEvent>());
  private readonly scope: string;
  private resources: readonly Resource[] = [];
  private executions: readonly ResourceExecution[] = [];
  private requests: Record<string, string> = {};
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    @IAtomicDocumentStore private readonly store: IAtomicDocumentStore,
    @IWorkspaceContext private readonly context: IWorkspaceContext,
    @IWorkspacePolicyService private readonly policy: IWorkspacePolicyService,
    @IWorkspacePlatformEventService private readonly events: IWorkspacePlatformEventService,
  ) {
    super();
    this.scope = `${context.persistenceScope}/platform`;
    this.onDidChange = this.changes.event;
    this.ready = this.load();
  }

  async list(type?: ResourceType): Promise<readonly Resource[]> {
    await this.ready;
    return this.resources.filter((resource) => type === undefined || resource.type === type);
  }

  async get(id: string): Promise<Resource | undefined> {
    await this.ready;
    return this.resources.find((resource) => resource.id === id);
  }

  async create(input: ResourceCreateInput): Promise<Resource> {
    const command = resourceCreateInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const existingId = this.requests[command.request_id];
      if (existingId !== undefined) return this.require(existingId);
      if (this.resources.some((resource) => resource.name === command.name)) {
        throw new ResourceServiceError(
          ResourceErrors.codes.RESOURCE_NAME_TAKEN,
          `resource name already exists: ${command.name}`,
          { name: command.name },
        );
      }
      const now = nowIsoDateTime();
      const resource = resourceSchema.parse({
        id: `res_${ulid()}`,
        workspace_id: this.context.workspaceId,
        type: command.type,
        name: command.name,
        state: 'draft',
        version: 1,
        created_at: now,
        updated_at: now,
        metadata: command.metadata,
      });
      await this.replace([...this.resources, resource], this.executions, {
        ...this.requests,
        [command.request_id]: resource.id,
      });
      await this.events.append({
        event_type: 'resource.created',
        entity_type: 'resource',
        entity_id: resource.id,
        request_id: command.request_id,
        actor: 'user',
        state: resource.state,
        payload: { type: resource.type, version: resource.version },
      });
      this.changes.fire({ resource, kind: 'created' });
      return resource;
    });
  }

  async update(id: string, input: ResourceUpdateInput): Promise<Resource | undefined> {
    const command = resourceUpdateInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const current = this.require(id);
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.require(mapped);
      if (current.state === 'archived' && command.state !== 'archived') {
        throw new ResourceServiceError(
          ResourceErrors.codes.RESOURCE_INVALID_STATE,
          `archived resource cannot be updated: ${id}`,
          { id, state: current.state },
        );
      }
      const { request_id: _requestId, ...patch } = command;
      const next = resourceSchema.parse({
        ...current,
        ...patch,
        version: current.version + 1,
        updated_at: nowIsoDateTime(),
      });
      await this.replace(
        this.resources.map((resource) => (resource.id === id ? next : resource)),
        this.executions,
        { ...this.requests, [command.request_id]: id },
      );
      await this.events.append({
        event_type: next.state === current.state ? 'resource.updated' : 'resource.state_changed',
        entity_type: 'resource',
        entity_id: id,
        request_id: command.request_id,
        actor: 'user',
        state: next.state,
        payload: { version: next.version },
      });
      this.changes.fire({ resource: next, kind: next.state === current.state ? 'updated' : 'state_changed' });
      return next;
    });
  }

  async archive(id: string, input: ResourceUpdateInput): Promise<Resource | undefined> {
    return this.update(id, { ...input, state: 'archived' });
  }

  async execute(id: string, input: ResourceExecuteInput): Promise<ResourceExecution> {
    const command = resourceExecuteInputSchema.parse(input);
    assertSafeMetadata(command.parameters);
    return this.enqueue(async () => {
      await this.ready;
      const resource = this.require(id);
      const existing = this.executions.find((execution) => execution.request_id === command.request_id);
      if (existing !== undefined) return existing;

      const policy = command.policy_decision_id === undefined
        ? await this.policy.evaluate({
          request_id: `resource_policy_${command.request_id}`,
          run_id: command.run_id,
          capability: resourceCapability(resource.type),
          action: command.action,
          requested_by: 'agent',
          metadata: { resource_id: resource.id, resource_type: resource.type },
        })
        : await this.policy.assertUsable(command.policy_decision_id, {
          capability: resourceCapability(resource.type),
          action: command.action,
          run_id: command.run_id,
        });
      if (policy === undefined) {
        throw new ResourceServiceError(
          ResourceErrors.codes.RESOURCE_INVALID_STATE,
          `policy decision not found: ${command.policy_decision_id}`,
          { policyDecisionId: command.policy_decision_id },
        );
      }
      const now = nowIsoDateTime();
      const allowed = policy.outcome === 'allow' && policy.state !== 'denied';
      const denied = policy.outcome === 'deny' || policy.state === 'denied';
      const execution = resourceExecutionSchema.parse({
        request_id: command.request_id,
        resource_id: resource.id,
        run_id: command.run_id,
        status: allowed ? 'completed' : denied ? 'failed' : 'awaiting_approval',
        policy_decision_id: policy.id,
        metrics: allowed ? { resource_version: resource.version } : undefined,
        started_at: now,
        completed_at: allowed || denied ? now : undefined,
        error: denied ? policy.reason : undefined,
      });
      const nextResource = resourceSchema.parse({
        ...resource,
        state: allowed ? 'ready' : denied ? 'failed' : resource.state,
        updated_at: now,
        version: resource.version + 1,
      });
      await this.replace(
        this.resources.map((candidate) => (candidate.id === id ? nextResource : candidate)),
        [...this.executions, execution],
        { ...this.requests, [command.request_id]: id },
      );
      await this.events.append({
        event_type: allowed ? 'resource.completed' : denied ? 'resource.failed' : 'resource.updated',
        entity_type: 'resource',
        entity_id: id,
        request_id: command.request_id,
        actor: 'agent',
        state: nextResource.state,
        payload: { execution_status: execution.status, policy_decision_id: policy.id },
      });
      this.changes.fire({ resource: nextResource, kind: 'state_changed' });
      return execution;
    });
  }

  private require(id: string): Resource {
    const resource = this.resources.find((candidate) => candidate.id === id);
    if (resource === undefined) {
      throw new ResourceServiceError(ResourceErrors.codes.RESOURCE_NOT_FOUND, `resource not found: ${id}`, { id });
    }
    return resource;
  }

  private async load(): Promise<void> {
    const raw = await this.store.get<unknown>(this.scope, RESOURCE_KEY);
    if (raw === undefined) {
      await this.replace([], [], {});
      return;
    }
    const document = resourceDocumentSchema.parse(raw);
    this.resources = document.resources;
    this.executions = document.executions;
    this.requests = document.requests;
  }

  private async replace(
    resources: readonly Resource[],
    executions: readonly ResourceExecution[],
    requests: Record<string, string>,
  ): Promise<void> {
    const document: ResourceDocument = {
      version: DOCUMENT_VERSION,
      resources: [...resources],
      executions: [...executions],
      requests,
    };
    await this.store.set(this.scope, RESOURCE_KEY, document);
    this.resources = document.resources;
    this.executions = document.executions;
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

function resourceCapability(type: ResourceType): 'dataset' | 'model' | 'connector' | 'serving' | 'cloud' {
  if (type === 'dataset' || type === 'table' || type === 'query') return 'dataset';
  if (type === 'model' || type === 'evaluation') return 'model';
  if (type === 'endpoint') return 'serving';
  if (type === 'pipeline' || type === 'experiment' || type === 'notebook') return 'cloud';
  return 'connector';
}

function assertSafeMetadata(metadata: Readonly<Record<string, unknown>> | undefined): void {
  if (metadata === undefined) return;
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      const nextPath = path.length === 0 ? key : `${path}.${key}`;
      if (sensitiveKey.test(key)) {
        throw new ResourceServiceError(
          ResourceErrors.codes.RESOURCE_SECRET_MATERIAL,
          `resource metadata cannot contain secret material in '${nextPath}'`,
          { key: nextPath },
        );
      }
      visit(nested, nextPath);
    }
  };
  visit(metadata, 'metadata');
}

registerScopedService(
  LifecycleScope.Workspace,
  IWorkspaceResourceService,
  WorkspaceResourceService,
  ScopeActivation.OnScopeCreated,
  'resources',
);
