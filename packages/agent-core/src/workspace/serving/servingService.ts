/** Durable model packaging and serving endpoint lifecycle. */

import { ulid } from 'ulid';
import { z } from 'zod';

import { Disposable } from '#/_base/di/lifecycle';
import { isError2 } from '#/errors';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { Emitter, type Event } from '#/_base/event';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import { IWorkspaceArtifactService } from '#/workspace/artifacts/artifact';
import { IWorkspaceExecutionService } from '#/workspace/execution/execution';
import { IWorkspaceExecutionTargetService } from '#/workspace/executionTargets/executionTarget';
import { IWorkspaceMlService } from '#/workspace/ml/ml';
import { IWorkspacePlatformEventService } from '#/workspace/platformEvents/platformEvents';
import { IWorkspacePolicyService } from '#/workspace/policy/policy';
import { findSensitivePlatformMetadataPath } from '#/workspace/platformServices/metadata';
import {
  modelPackageCreateInputSchema,
  modelPackageSchema,
  nowIsoDateTime,
  servingEndpointActionInputSchema,
  servingEndpointCreateInputSchema,
  servingEndpointSchema,
  type ModelPackage,
  type ModelPackageCreateInput,
  type ServingEndpoint,
  type ServingEndpointActionInput,
  type ServingEndpointCreateInput,
} from '@spiderbyte/protocol';

import { IWorkspaceServingService, type WorkspaceServingChangedEvent } from './serving';
import { ServingErrors, ServingServiceError } from './errors';

const DOCUMENT_VERSION = 1;
const SERVING_KEY = 'serving.json';
const MAX_PACKAGE_BYTES = 8 * 1024 * 1024;

const documentSchema = z.strictObject({
  version: z.literal(DOCUMENT_VERSION),
  packages: z.array(modelPackageSchema),
  endpoints: z.array(servingEndpointSchema),
  requests: z.record(z.string(), z.string()).default({}),
});

type ServingDocument = {
  readonly version: 1;
  readonly packages: readonly ModelPackage[];
  readonly endpoints: readonly ServingEndpoint[];
  readonly requests: Readonly<Record<string, string>>;
};

export class WorkspaceServingService extends Disposable implements IWorkspaceServingService {
  declare readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  readonly onDidChange: Event<WorkspaceServingChangedEvent>;

  private readonly changes = this._register(new Emitter<WorkspaceServingChangedEvent>());
  private readonly scope: string;
  private packages: readonly ModelPackage[] = [];
  private endpoints: readonly ServingEndpoint[] = [];
  private requests: Record<string, string> = {};
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    @IAtomicDocumentStore private readonly store: IAtomicDocumentStore,
    @IWorkspaceContext private readonly context: IWorkspaceContext,
    @IWorkspaceMlService private readonly ml: IWorkspaceMlService,
    @IWorkspaceArtifactService private readonly artifacts: IWorkspaceArtifactService,
    @IWorkspaceExecutionTargetService private readonly targets: IWorkspaceExecutionTargetService,
    @IWorkspaceExecutionService private readonly execution: IWorkspaceExecutionService,
    @IWorkspacePolicyService private readonly policy: IWorkspacePolicyService,
    @IWorkspacePlatformEventService private readonly events: IWorkspacePlatformEventService,
  ) {
    super();
    this.scope = `${context.persistenceScope}/platform`;
    this.onDidChange = this.changes.event;
    this.ready = this.load();
  }

  async listPackages(): Promise<readonly ModelPackage[]> {
    await this.ready;
    return [...this.packages];
  }

  async getPackage(id: string): Promise<ModelPackage | undefined> {
    await this.ready;
    return this.packages.find((candidate) => candidate.id === id);
  }

  async createPackage(input: ModelPackageCreateInput): Promise<ModelPackage | undefined> {
    const command = modelPackageCreateInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.requirePackage(mapped);
      const model = await this.ml.getModel(command.model_version_id);
      if (model === undefined) {
        throw new ServingServiceError(
          ServingErrors.codes.SERVING_MODEL_NOT_FOUND,
          `model version not found: ${command.model_version_id}`,
          { model_version_id: command.model_version_id },
        );
      }
      const decision = await this.policyDecision(
        command.request_id,
        command.run_id,
        command.model_policy_decision_id,
        `package:${model.model_name}`,
        'model',
      );
      const now = nowIsoDateTime();
      if (!isAllowed(decision)) {
        const awaiting = modelPackageSchema.parse({
          id: `package_${ulid()}`,
          workspace_id: this.context.workspaceId,
          model_version_id: model.id,
          model_artifact_id: model.artifact_id,
          execution_target_id: command.execution_target_id,
          execution_target_policy_decision_id: command.execution_target_policy_decision_id,
          state: decision.outcome === 'deny' ? 'failed' : 'awaiting_approval',
          policy_decision_id: decision.id,
          created_at: now,
          updated_at: now,
          error: decision.reason,
          metadata: command.metadata,
        });
        await this.replace({
          packages: [...this.packages, awaiting],
          endpoints: this.endpoints,
          requests: { ...this.requests, [command.request_id]: awaiting.id },
        });
        await this.events.append({
          event_type: 'model_package.created',
          entity_type: 'model_package',
          entity_id: awaiting.id,
          request_id: command.request_id,
          actor: 'agent',
          state: awaiting.state,
          payload: { model_version_id: model.id, policy_decision_id: decision.id },
        });
        this.changes.fire({ kind: 'package_created', package: awaiting });
        return awaiting;
      }
      const source = await this.artifacts.download(model.artifact_id);
      if (source === undefined) {
        throw new ServingServiceError(
          ServingErrors.codes.SERVING_ARTIFACT_INVALID,
          `model artifact is unavailable: ${model.artifact_id}`,
          { artifact_id: model.artifact_id },
        );
      }
      const bytes = Buffer.from(source.content_base64, 'base64');
      if (bytes.byteLength > MAX_PACKAGE_BYTES) {
        throw new ServingServiceError(
          ServingErrors.codes.SERVING_ARTIFACT_INVALID,
          'model artifact is too large to package',
          { size_bytes: bytes.byteLength },
        );
      }
      const bundle = await this.artifacts.create({
        request_id: `${command.request_id}:bundle`,
        run_id: command.run_id,
        name: `${model.model_name}.v${model.version}.bundle.json`,
        kind: 'bundle',
        content_base64: source.content_base64,
        media_type: source.artifact.media_type ?? 'application/json',
        source_artifact_ids: [model.artifact_id],
        metadata: {
          model_version_id: model.id,
          model_name: model.model_name,
          package_schema_version: 1,
          ...command.metadata,
        },
      });
      const packaged = modelPackageSchema.parse({
        id: `package_${ulid()}`,
        workspace_id: this.context.workspaceId,
        model_version_id: model.id,
        model_artifact_id: model.artifact_id,
        bundle_artifact_id: bundle.id,
        execution_target_id: command.execution_target_id,
        execution_target_policy_decision_id: command.execution_target_policy_decision_id,
        state: 'ready',
        policy_decision_id: decision.id,
        created_at: now,
        updated_at: now,
        metadata: command.metadata,
      });
      await this.replace({
        packages: [...this.packages, packaged],
        endpoints: this.endpoints,
        requests: { ...this.requests, [command.request_id]: packaged.id },
      });
      await this.events.append({
        event_type: 'model_package.created',
        entity_type: 'model_package',
        entity_id: packaged.id,
        request_id: command.request_id,
        actor: 'agent',
        state: packaged.state,
        payload: { model_version_id: packaged.model_version_id, bundle_artifact_id: bundle.id },
      });
      this.changes.fire({ kind: 'package_created', package: packaged });
      return packaged;
    });
  }

  async listEndpoints(): Promise<readonly ServingEndpoint[]> {
    await this.ready;
    return [...this.endpoints];
  }

  async getEndpoint(id: string): Promise<ServingEndpoint | undefined> {
    await this.ready;
    return this.endpoints.find((candidate) => candidate.id === id);
  }

  async deploy(input: ServingEndpointCreateInput): Promise<ServingEndpoint | undefined> {
    const command = servingEndpointCreateInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.requireEndpoint(mapped);
      if (this.endpoints.some((endpoint) => endpoint.name === command.name && endpoint.state !== 'archived')) {
        throw new ServingServiceError(ServingErrors.codes.SERVING_NAME_TAKEN, `serving endpoint name already exists: ${command.name}`);
      }
      const endpoint = await this.prepareEndpoint(command);
      await this.replace({
        packages: this.packages,
        endpoints: [...this.endpoints, endpoint],
        requests: { ...this.requests, [command.request_id]: endpoint.id },
      });
      this.changes.fire({ kind: 'endpoint_updated', endpoint });
      if (endpoint.state !== 'deploying') {
        await this.emitEndpoint(endpoint, command.request_id);
        return endpoint;
      }
      const deployed = await this.executeDeployment(endpoint, command.request_id, command.attempt_id);
      await this.replace({
        packages: this.packages,
        endpoints: this.endpoints.map((candidate) => candidate.id === deployed.id ? deployed : candidate),
        requests: this.requests,
      });
      await this.emitEndpoint(deployed, command.request_id);
      this.changes.fire({ kind: 'endpoint_updated', endpoint: deployed });
      return deployed;
    });
  }

  async action(
    id: string,
    action: 'pause' | 'resume' | 'archive' | 'rollback',
    input: ServingEndpointActionInput,
  ): Promise<ServingEndpoint | undefined> {
    const command = servingEndpointActionInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const current = this.endpoints.find((endpoint) => endpoint.id === id);
      if (current === undefined) return undefined;
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.requireEndpoint(mapped);
      if (action === 'pause' || action === 'resume' || action === 'archive') {
        const expected = action === 'pause' ? 'ready' : action === 'resume' ? 'paused' : undefined;
        if (expected !== undefined && current.state !== expected) {
          throw new ServingServiceError(ServingErrors.codes.SERVING_INVALID_STATE, `endpoint is ${current.state}, cannot ${action}`);
        }
        let leaseId = current.lease_id;
        let policyDecisionId = current.policy_decision_id;
        let executionTargetPolicyDecisionId = current.execution_target_policy_decision_id;
        let nextState: ServingEndpoint['state'] = action === 'pause' ? 'paused' : action === 'resume' ? 'ready' : 'archived';
        let workerMetadata: Readonly<Record<string, unknown>> | undefined;
        let workerEndpointUrl: string | undefined;
        const remoteTarget = await this.isRemoteTarget(current.execution_target_id);
        if ((action === 'pause' || action === 'archive') && leaseId !== undefined && current.execution_target_id !== undefined) {
          if (remoteTarget) {
            const worker = await this.executeWorkerAction(current, command.request_id, action, command.attempt_id);
            workerMetadata = worker.metadata;
            workerEndpointUrl = worker.endpoint_url;
          }
          await this.targets.releaseLease(current.execution_target_id, leaseId, {
            request_id: `${command.request_id}:lease:release`,
          });
          leaseId = undefined;
        } else if (action === 'resume' && current.execution_target_id !== undefined) {
          const lease = await this.targets.acquireLease(current.execution_target_id, {
            request_id: `${command.request_id}:lease`,
            run_id: command.run_id ?? current.deployment_run_id,
            duration_seconds: 3_600,
            policy_decision_id: command.execution_target_policy_decision_id ?? current.execution_target_policy_decision_id,
          });
          leaseId = lease.id;
          policyDecisionId = lease.policy_decision_id ?? policyDecisionId;
          executionTargetPolicyDecisionId = command.execution_target_policy_decision_id ?? lease.policy_decision_id ?? executionTargetPolicyDecisionId;
          if (lease.state === 'awaiting_approval') {
            nextState = 'awaiting_approval';
          } else if (remoteTarget) {
            try {
              const worker = await this.executeWorkerAction(
                { ...current, lease_id: lease.id },
                command.request_id,
                action,
                command.attempt_id,
              );
              workerMetadata = worker.metadata;
              workerEndpointUrl = worker.endpoint_url;
            } catch (error) {
              await this.targets.releaseLease(current.execution_target_id, lease.id, {
                request_id: `${command.request_id}:lease:rollback`,
              }).catch(() => undefined);
              throw error;
            }
          }
        }
        const next = servingEndpointSchema.parse({
          ...current,
          state: nextState,
          lease_id: leaseId,
          endpoint_url: workerEndpointUrl ?? current.endpoint_url,
          policy_decision_id: policyDecisionId,
          execution_target_policy_decision_id: executionTargetPolicyDecisionId,
          updated_at: nowIsoDateTime(),
          metadata: {
            ...current.metadata,
            ...(workerMetadata === undefined ? {} : { worker: workerMetadata }),
            ...command.metadata,
          },
          ...(nextState === 'awaiting_approval' ? { error: 'execution target approval is required' } : { error: undefined }),
        });
        await this.replace({
          packages: this.packages,
          endpoints: this.endpoints.map((candidate) => candidate.id === id ? next : candidate),
          requests: { ...this.requests, [command.request_id]: id },
        });
        await this.emitEndpoint(next, command.request_id);
        this.changes.fire({ kind: 'endpoint_updated', endpoint: next });
        return next;
      }
      const packageId = command.model_package_id;
      if (packageId === undefined) {
        throw new ServingServiceError(ServingErrors.codes.SERVING_ACTION_INVALID, 'rollback requires a model_package_id');
      }
      const packageRecord = this.requirePackage(packageId);
      if (packageRecord.state !== 'ready' || packageRecord.bundle_artifact_id === undefined) {
        throw new ServingServiceError(ServingErrors.codes.SERVING_INVALID_STATE, `model package is ${packageRecord.state}`);
      }
      const decision = await this.policyDecision(
        command.request_id,
        command.run_id ?? current.deployment_run_id,
        command.deploy_policy_decision_id,
        `rollback:${current.name}`,
      );
      if (!isAllowed(decision)) {
        const awaiting = servingEndpointSchema.parse({
          ...current,
          state: decision.outcome === 'deny' ? 'failed' : 'awaiting_approval',
          policy_decision_id: decision.id,
          updated_at: nowIsoDateTime(),
          error: decision.reason,
        });
        await this.replace({
          packages: this.packages,
          endpoints: this.endpoints.map((candidate) => candidate.id === id ? awaiting : candidate),
          requests: { ...this.requests, [command.request_id]: id },
        });
        await this.emitEndpoint(awaiting, command.request_id);
        this.changes.fire({ kind: 'endpoint_updated', endpoint: awaiting });
        return awaiting;
      }
      const next = servingEndpointSchema.parse({
        ...current,
        model_package_id: packageRecord.id,
        model_version_id: packageRecord.model_version_id,
        bundle_artifact_id: packageRecord.bundle_artifact_id,
        execution_target_id: packageRecord.execution_target_id ?? current.execution_target_id,
        deployment_run_id: command.run_id ?? current.deployment_run_id,
        state: 'deploying',
        endpoint_url: undefined,
        lineage_artifact_ids: [packageRecord.bundle_artifact_id, packageRecord.model_artifact_id],
        policy_decision_id: decision.id,
        rollback_of_endpoint_id: current.id,
        updated_at: nowIsoDateTime(),
        error: undefined,
        metadata: command.metadata ?? current.metadata,
      });
      const deployed = await this.executeDeployment(next, command.request_id, command.attempt_id);
      await this.replace({
        packages: this.packages,
        endpoints: this.endpoints.map((candidate) => candidate.id === id ? deployed : candidate),
        requests: { ...this.requests, [command.request_id]: id },
      });
      await this.emitEndpoint(deployed, command.request_id);
      this.changes.fire({ kind: 'endpoint_updated', endpoint: deployed });
      return deployed;
    });
  }

  private async prepareEndpoint(command: ServingEndpointCreateInput): Promise<ServingEndpoint> {
    const packageRecord = this.requirePackage(command.model_package_id);
    if (packageRecord.state !== 'ready' || packageRecord.bundle_artifact_id === undefined) {
      throw new ServingServiceError(ServingErrors.codes.SERVING_INVALID_STATE, `model package is ${packageRecord.state}`);
    }
    const targetId = command.execution_target_id ?? packageRecord.execution_target_id;
    const decision = await this.policyDecision(
      command.request_id,
      command.run_id,
      command.deploy_policy_decision_id,
      `deploy:${command.name}`,
    );
    if (!isAllowed(decision)) {
      return servingEndpointSchema.parse({
        id: `endpoint_${ulid()}`,
        workspace_id: this.context.workspaceId,
        name: command.name,
        model_package_id: packageRecord.id,
        model_version_id: packageRecord.model_version_id,
        bundle_artifact_id: packageRecord.bundle_artifact_id,
        execution_target_id: targetId,
        execution_target_policy_decision_id: command.execution_target_policy_decision_id,
        deployment_run_id: command.run_id,
        state: decision.outcome === 'deny' ? 'failed' : 'awaiting_approval',
        lineage_artifact_ids: [packageRecord.bundle_artifact_id, packageRecord.model_artifact_id],
        policy_decision_id: decision.id,
        created_at: nowIsoDateTime(),
        updated_at: nowIsoDateTime(),
        error: decision.reason,
        metadata: command.metadata,
      });
    }
    if (targetId !== undefined) {
      const target = await this.targets.get(targetId);
      if (target === undefined || target.state !== 'ready') {
        throw new ServingServiceError(ServingErrors.codes.SERVING_TARGET_UNAVAILABLE, `execution target is not ready: ${targetId}`);
      }
      const lease = await this.targets.acquireLease(targetId, {
        request_id: `${command.request_id}:lease`,
        run_id: command.run_id,
        duration_seconds: 3_600,
        policy_decision_id: command.execution_target_policy_decision_id,
      });
      if (lease.state === 'awaiting_approval') {
        return servingEndpointSchema.parse({
          id: `endpoint_${ulid()}`,
          workspace_id: this.context.workspaceId,
          name: command.name,
          model_package_id: packageRecord.id,
          model_version_id: packageRecord.model_version_id,
          bundle_artifact_id: packageRecord.bundle_artifact_id,
          execution_target_id: targetId,
          execution_target_policy_decision_id: command.execution_target_policy_decision_id ?? lease.policy_decision_id,
          lease_id: lease.id,
          deployment_run_id: command.run_id,
          state: 'awaiting_approval',
          lineage_artifact_ids: [packageRecord.bundle_artifact_id, packageRecord.model_artifact_id],
          policy_decision_id: lease.policy_decision_id,
          created_at: nowIsoDateTime(),
          updated_at: nowIsoDateTime(),
          error: 'execution target approval is required',
          metadata: command.metadata,
        });
      }
      // Keep the active lease attached to the endpoint for its lifetime so a
      // second deployment cannot silently contend for the same target.
      return servingEndpointSchema.parse({
        id: `endpoint_${ulid()}`,
        workspace_id: this.context.workspaceId,
        name: command.name,
        model_package_id: packageRecord.id,
        model_version_id: packageRecord.model_version_id,
        bundle_artifact_id: packageRecord.bundle_artifact_id,
        execution_target_id: targetId,
        execution_target_policy_decision_id: command.execution_target_policy_decision_id ?? lease.policy_decision_id,
        lease_id: lease.id,
        deployment_run_id: command.run_id,
        state: 'deploying',
        lineage_artifact_ids: [packageRecord.bundle_artifact_id, packageRecord.model_artifact_id],
        policy_decision_id: decision.id,
        created_at: nowIsoDateTime(),
        updated_at: nowIsoDateTime(),
        metadata: command.metadata,
      });
    }
    return servingEndpointSchema.parse({
      id: `endpoint_${ulid()}`,
      workspace_id: this.context.workspaceId,
      name: command.name,
      model_package_id: packageRecord.id,
      model_version_id: packageRecord.model_version_id,
      bundle_artifact_id: packageRecord.bundle_artifact_id,
      execution_target_id: targetId,
      execution_target_policy_decision_id: command.execution_target_policy_decision_id,
      deployment_run_id: command.run_id,
      state: 'deploying',
      lineage_artifact_ids: [packageRecord.bundle_artifact_id, packageRecord.model_artifact_id],
      policy_decision_id: decision.id,
      created_at: nowIsoDateTime(),
      updated_at: nowIsoDateTime(),
      metadata: command.metadata,
    });
  }

  private async executeDeployment(
    endpoint: ServingEndpoint,
    requestId: string,
    attemptId?: string,
  ): Promise<ServingEndpoint> {
    if (endpoint.execution_target_id === undefined) {
      return servingEndpointSchema.parse({
        ...endpoint,
        state: 'ready',
        endpoint_url: `local://${endpoint.id}`,
        updated_at: nowIsoDateTime(),
      });
    }
    const target = await this.targets.get(endpoint.execution_target_id);
    if (target === undefined) throw new ServingServiceError(ServingErrors.codes.SERVING_TARGET_UNAVAILABLE, `execution target not found: ${endpoint.execution_target_id}`);
    if (target.type === 'local') {
      return servingEndpointSchema.parse({
        ...endpoint,
        state: 'ready',
        endpoint_url: `local://${endpoint.id}`,
        updated_at: nowIsoDateTime(),
      });
    }
    try {
      const result = await this.executeWorkerAction(endpoint, requestId, 'deploy', attemptId);
      return servingEndpointSchema.parse({
        ...endpoint,
        state: 'ready',
        endpoint_url: result.endpoint_url,
        updated_at: nowIsoDateTime(),
        metadata: { ...endpoint.metadata, worker: result.metadata },
      });
    } catch (error) {
      return servingEndpointSchema.parse({
        ...endpoint,
        state: 'failed',
        updated_at: nowIsoDateTime(),
        error: safeError(error),
      });
    }
  }

  private async isRemoteTarget(targetId: string | undefined): Promise<boolean> {
    if (targetId === undefined) return false;
    const target = await this.targets.get(targetId);
    if (target === undefined) {
      throw new ServingServiceError(ServingErrors.codes.SERVING_TARGET_UNAVAILABLE, `execution target not found: ${targetId}`);
    }
    return target.type !== 'local';
  }

  private async executeWorkerAction(
    endpoint: ServingEndpoint,
    requestId: string,
    action: 'deploy' | 'pause' | 'resume' | 'archive',
    attemptId?: string,
  ): Promise<{ readonly endpoint_url?: string; readonly metadata?: Readonly<Record<string, unknown>> }> {
    if (endpoint.execution_target_id === undefined || endpoint.lease_id === undefined) {
      throw new ServingServiceError(
        ServingErrors.codes.SERVING_TARGET_UNAVAILABLE,
        `serving worker action requires an active execution-target lease: ${action}`,
      );
    }
    const result = await this.execution.execute({
      request_id: `${requestId}:worker:${action}`,
      run_id: endpoint.deployment_run_id,
      attempt_id: attemptId,
      target_id: endpoint.execution_target_id,
      lease_id: endpoint.lease_id,
      operation: 'serving',
      policy_decision_id: endpoint.policy_decision_id,
      payload: {
        endpoint_id: endpoint.id,
        endpoint_name: endpoint.name,
        model_package_id: endpoint.model_package_id,
        model_version_id: endpoint.model_version_id,
        bundle_artifact_id: endpoint.bundle_artifact_id,
        action,
      },
    });
    if (result.status === 'failed') {
      throw new ServingServiceError(ServingErrors.codes.SERVING_TARGET_UNAVAILABLE, result.error ?? `serving worker ${action} failed`);
    }
    return {
      endpoint_url: typeof result.metadata?.['endpoint_url'] === 'string' ? result.metadata['endpoint_url'] : undefined,
      metadata: result.metadata,
    };
  }

  private async policyDecision(
    requestId: string,
    runId: string | undefined,
    suppliedId: string | undefined,
    action: string,
    capability: 'deploy' | 'model' = 'deploy',
  ) {
    if (suppliedId === undefined) {
      return this.policy.evaluate({
        request_id: `${requestId}:policy`,
        run_id: runId,
        capability,
        action,
        requested_by: 'agent',
        metadata: { source: 'serving_service' },
      });
    }
    try {
      return await this.policy.assertUsable(suppliedId, { capability, action, run_id: runId });
    } catch (error) {
      const reason = isError2(error) ? error.message : 'serving policy decision is not approved';
      throw new ServingServiceError(
        ServingErrors.codes.SERVING_POLICY_REQUIRED,
        reason,
        { policy_decision_id: suppliedId },
      );
    }
  }

  private requirePackage(id: string): ModelPackage {
    const value = this.packages.find((candidate) => candidate.id === id);
    if (value === undefined) throw new ServingServiceError(ServingErrors.codes.SERVING_PACKAGE_NOT_FOUND, `model package not found: ${id}`, { id });
    return value;
  }

  private requireEndpoint(id: string): ServingEndpoint {
    const value = this.endpoints.find((candidate) => candidate.id === id);
    if (value === undefined) throw new ServingServiceError(ServingErrors.codes.SERVING_NOT_FOUND, `serving endpoint not found: ${id}`, { id });
    return value;
  }

  private async emitEndpoint(endpoint: ServingEndpoint, requestId: string): Promise<void> {
    await this.events.append({
      event_type: 'serving_endpoint.state_changed',
      entity_type: 'serving_endpoint',
      entity_id: endpoint.id,
      request_id: requestId,
      actor: 'agent',
      state: endpoint.state,
      payload: {
        model_package_id: endpoint.model_package_id,
        model_version_id: endpoint.model_version_id,
        execution_target_id: endpoint.execution_target_id,
        endpoint_url: endpoint.endpoint_url,
      },
    });
  }

  private async load(): Promise<void> {
    const raw = await this.store.get<unknown>(this.scope, SERVING_KEY);
    if (raw === undefined) {
      await this.replace({ packages: [], endpoints: [], requests: {} });
      return;
    }
    const document = documentSchema.parse(raw);
    this.packages = document.packages;
    this.endpoints = document.endpoints;
    this.requests = document.requests;
  }

  private async replace(document: Omit<ServingDocument, 'version'>): Promise<void> {
    const next: ServingDocument = { version: DOCUMENT_VERSION, ...document };
    await this.store.set(this.scope, SERVING_KEY, next);
    this.packages = next.packages;
    this.endpoints = next.endpoints;
    this.requests = next.requests;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(work, work);
    this.mutationQueue = next.then(() => undefined, () => undefined);
    return next;
  }
}

function isAllowed(decision: { readonly outcome?: string; readonly state?: string }): boolean {
  return decision.outcome === 'allow' || decision.state === 'approved' || decision.state === 'audited';
}

function assertSafeMetadata(metadata: Readonly<Record<string, unknown>> | undefined): void {
  const path = findSensitivePlatformMetadataPath(metadata);
  if (path !== undefined) {
    throw new ServingServiceError(
      ServingErrors.codes.SERVING_SECRET_MATERIAL,
      `serving metadata cannot contain secret material in '${path}'`,
      { key: path },
    );
  }
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

registerScopedService(
  LifecycleScope.Workspace,
  IWorkspaceServingService,
  WorkspaceServingService,
  ScopeActivation.OnDemand,
  'serving',
);
