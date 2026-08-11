/**
 * `execution` domain — governed self-hosted worker adapter implementation.
 *
 * Dispatches non-local ML operations to a customer-managed worker,
 * resolves target credentials only into the outbound authorization header,
 * validates the worker response, and imports returned content-addressed
 * artifacts into the workspace artifact service. Bound at Workspace scope.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';

import { Disposable } from '#/_base/di/lifecycle';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { IPlatformSecretStore } from '#/app/secrets/platformSecretStore';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { IWorkspaceArtifactService } from '#/workspace/artifacts/artifact';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import { IWorkspaceUsageService } from '#/workspace/usage/usage';
import { IWorkspaceBudgetService } from '#/workspace/budgets/budget';
import { IWorkspaceExecutionTargetService } from '#/workspace/executionTargets/executionTarget';
import { findSensitivePlatformMetadataPath } from '#/workspace/platformServices/metadata';
import {
  artifactKindSchema,
  platformMetadataSchema,
  type BudgetReservation,
  type ExecutionTarget,
} from '@spiderbyte/protocol';

import {
  IWorkspaceExecutionService,
  type WorkspaceExecutionRequest,
  type WorkspaceExecutionResult,
} from './execution';
import { ExecutionErrors, ExecutionServiceError } from './errors';

const MAX_WORKER_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const WORKER_TIMEOUT_MS = 5 * 60 * 1_000;
const WORKER_RETRY_COUNT = 2;
const WORKER_RETRY_BACKOFF_MS = 250;
const EXECUTION_KEY = 'execution.json';
const DOCUMENT_VERSION = 1;

const workerArtifactSchema = z.strictObject({
  name: z.string().min(1).max(500),
  kind: artifactKindSchema,
  content_base64: z.string().max(Math.ceil((MAX_ARTIFACT_BYTES * 4) / 3) + 4),
  media_type: z.string().min(1).optional(),
  source_artifact_ids: z.array(z.string().min(1)).max(100).optional(),
  metadata: platformMetadataSchema.optional(),
});

const workerResponseSchema = z.strictObject({
  status: z.enum(['succeeded', 'failed']),
  output_artifacts: z.array(workerArtifactSchema).max(100).default([]),
  metrics: z.record(z.string(), z.number().finite()).optional(),
  metadata: platformMetadataSchema.optional(),
  error: z.string().max(2_000).optional(),
});

type WorkerResponse = z.infer<typeof workerResponseSchema>;

const executionResultSchema = z.strictObject({
  status: z.enum(['succeeded', 'failed']),
  output_artifact_ids: z.array(z.string().min(1)),
  metrics: z.record(z.string(), z.number().finite()).optional(),
  metadata: platformMetadataSchema.optional(),
  error: z.string().max(2_000).optional(),
});

const executionRecordSchema = z.strictObject({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  result: executionResultSchema,
});

const executionDocumentSchema = z.strictObject({
  version: z.literal(DOCUMENT_VERSION),
  requests: z.record(z.string(), executionRecordSchema),
});

type ExecutionDocument = z.infer<typeof executionDocumentSchema>;
type ExecutionRecord = z.infer<typeof executionRecordSchema>;

export class WorkspaceExecutionService extends Disposable implements IWorkspaceExecutionService {
  declare readonly _serviceBrand: undefined;

  constructor(
    @IAtomicDocumentStore private readonly store: IAtomicDocumentStore,
    @IWorkspaceContext private readonly context: IWorkspaceContext,
    @IWorkspaceExecutionTargetService private readonly targets: IWorkspaceExecutionTargetService,
    @IWorkspaceArtifactService private readonly artifacts: IWorkspaceArtifactService,
    @IPlatformSecretStore private readonly secrets: IPlatformSecretStore,
    @IWorkspaceUsageService private readonly usage: IWorkspaceUsageService,
    @IWorkspaceBudgetService private readonly budgets?: IWorkspaceBudgetService,
  ) {
    super();
    this.scope = `${context.persistenceScope}/platform`;
    this.ready = this.load();
  }

  readonly ready: Promise<void>;
  private readonly scope: string;
  private requests: Record<string, ExecutionRecord> = {};
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly inFlight = new Map<string, {
    readonly fingerprint: string;
    readonly promise: Promise<WorkspaceExecutionResult>;
    readonly controller: AbortController;
  }>();

  async execute(input: WorkspaceExecutionRequest): Promise<WorkspaceExecutionResult> {
    await this.ready;
    assertSafeMetadata(input.payload);
    const fingerprint = executionFingerprint(input);
    const existing = this.requests[input.request_id];
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        throw new ExecutionServiceError(
          ExecutionErrors.codes.EXECUTION_REQUEST_REUSED,
          'execution request id was already used with different request data',
          { requestId: input.request_id },
        );
      }
      return existing.result;
    }
    const running = this.inFlight.get(input.request_id);
    if (running !== undefined) {
      if (running.fingerprint !== fingerprint) {
        throw new ExecutionServiceError(
          ExecutionErrors.codes.EXECUTION_REQUEST_REUSED,
          'execution request id is already in flight with different request data',
          { requestId: input.request_id },
        );
      }
      return running.promise;
    }
    const controller = new AbortController();
    const promise = this.executeOnce(input, fingerprint, controller.signal);
    this.inFlight.set(input.request_id, { fingerprint, promise, controller });
    try {
      return await promise;
    } finally {
      this.inFlight.delete(input.request_id);
    }
  }

  async cancel(requestId: string): Promise<boolean> {
    const running = this.inFlight.get(requestId);
    if (running === undefined) return false;
    running.controller.abort();
    return true;
  }

  private async executeOnce(
    input: WorkspaceExecutionRequest,
    fingerprint: string,
    signal: AbortSignal,
  ): Promise<WorkspaceExecutionResult> {
    const startedAt = Date.now();
    const target = await this.targets.get(input.target_id);
    if (target === undefined) {
      throw new ExecutionServiceError(
        ExecutionErrors.codes.EXECUTION_TARGET_NOT_FOUND,
        'execution target not found: ' + input.target_id,
        { targetId: input.target_id },
      );
    }
    if (target.type === 'local') {
      throw new ExecutionServiceError(
        ExecutionErrors.codes.EXECUTION_TARGET_UNAVAILABLE,
        'local execution is owned by the native workspace executor',
        { targetId: target.id, targetType: target.type },
      );
    }
    if (input.lease_id === undefined) {
      throw new ExecutionServiceError(
        ExecutionErrors.codes.EXECUTION_TARGET_UNAVAILABLE,
        'remote execution requires an active execution-target lease',
        { targetId: target.id },
      );
    }
    const lease = await this.targets.getLease(target.id, input.lease_id);
    if (lease === undefined || lease.state !== 'active' || new Date(lease.expires_at).getTime() <= Date.now()) {
      throw new ExecutionServiceError(
        ExecutionErrors.codes.EXECUTION_TARGET_UNAVAILABLE,
        'execution-target lease is missing, inactive, or expired',
        { targetId: target.id, leaseId: input.lease_id },
      );
    }
    if (target.state !== 'ready') {
      throw new ExecutionServiceError(
        ExecutionErrors.codes.EXECUTION_TARGET_UNAVAILABLE,
        'execution target is not ready: ' + target.id,
        { targetId: target.id, state: target.state },
      );
    }
    if (target.capabilities.length > 0 && !hasCapability(target.capabilities, input.operation)) {
      throw new ExecutionServiceError(
        ExecutionErrors.codes.EXECUTION_TARGET_UNAVAILABLE,
        "execution target does not advertise '" + input.operation + "' capability",
        { targetId: target.id, operation: input.operation },
      );
    }

    const endpoint = workerEndpoint(target.metadata);
    const credential = await this.resolveCredential(target.credential_ref);
    const budgetReservation = await this.reserveBudget(target, input);
    let response: WorkerResponse;
    try {
      response = await this.callWorker(endpoint, credential, input, signal);
      // The remote call has completed, so charge the Run even if validating
      // or importing the worker's response fails below.
      await this.recordUsage(target.type, input, startedAt).catch(() => undefined);
      await this.reconcileBudget(budgetReservation, startedAt);
    } catch (error) {
      await this.recordUsage(target.type, input, startedAt).catch(() => undefined);
      await this.releaseBudget(budgetReservation);
      throw error;
    }
    if (response.status === 'failed') {
      if (response.metadata !== undefined) assertSafeMetadata(response.metadata);
      const result = executionResultSchema.parse({
        status: 'failed',
        output_artifact_ids: [],
        metadata: sanitizeMetadata(response.metadata, credential),
        error: response.error ?? 'remote execution failed',
      });
      await this.persist(input.request_id, fingerprint, result);
      return result;
    }

    const outputArtifactIds: string[] = [];
    if (response.metadata !== undefined) assertSafeMetadata(response.metadata);
    const declaredSourceArtifactIds = await this.declaredSourceArtifactIds(input.payload);
    for (const [index, artifact] of response.output_artifacts.entries()) {
      if (artifact.metadata !== undefined) assertSafeMetadata(artifact.metadata);
      assertArtifactDoesNotContainCredential(artifact.content_base64, credential);
      const sourceArtifactIds = [...new Set([
        ...declaredSourceArtifactIds,
        ...(artifact.source_artifact_ids ?? []),
      ])];
      for (const sourceId of sourceArtifactIds) {
        const source = await this.artifacts.get(sourceId);
        if (source === undefined || source.workspace_id !== this.context.workspaceId) {
          throw new ExecutionServiceError(
            ExecutionErrors.codes.EXECUTION_ARTIFACT_INVALID,
            'worker returned an unknown source artifact: ' + sourceId,
            { sourceArtifactId: sourceId },
          );
        }
      }
      const created = await this.artifacts.create({
        request_id: input.request_id + ':artifact:' + index,
        run_id: input.run_id,
        name: artifact.name,
        kind: artifact.kind,
        content_base64: artifact.content_base64,
        media_type: artifact.media_type,
        source_artifact_ids: sourceArtifactIds,
        metadata: {
          ...sanitizeMetadata(artifact.metadata, credential),
          execution_target_id: input.target_id,
          execution_operation: input.operation,
        },
      });
      outputArtifactIds.push(created.id);
    }
    const result = executionResultSchema.parse({
      status: 'succeeded',
      output_artifact_ids: outputArtifactIds,
      metrics: response.metrics,
      metadata: sanitizeMetadata(response.metadata, credential),
    });
    await this.persist(input.request_id, fingerprint, result);
    return result;
  }

  private async persist(
    requestId: string,
    fingerprint: string,
    result: WorkspaceExecutionResult,
  ): Promise<void> {
    await this.enqueue(async () => {
      await this.ready;
      const current = this.requests[requestId];
      if (current !== undefined) {
        if (current.fingerprint !== fingerprint) {
          throw new ExecutionServiceError(
            ExecutionErrors.codes.EXECUTION_REQUEST_REUSED,
            'execution request id was already used with different request data',
            { requestId },
          );
        }
        return;
      }
      const record = executionRecordSchema.parse({ fingerprint, result });
      const document: ExecutionDocument = {
        version: DOCUMENT_VERSION,
        requests: { ...this.requests, [requestId]: record },
      };
      await this.store.set(this.scope, EXECUTION_KEY, document);
      this.requests = document.requests;
    });
  }

  private async load(): Promise<void> {
    const raw = await this.store.get<unknown>(this.scope, EXECUTION_KEY);
    if (raw === undefined) {
      await this.store.set(this.scope, EXECUTION_KEY, {
        version: DOCUMENT_VERSION,
        requests: {},
      } satisfies ExecutionDocument);
      return;
    }
    const document = executionDocumentSchema.parse(raw);
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

  private async recordUsage(
    targetType: ExecutionTarget['type'],
    input: WorkspaceExecutionRequest,
    startedAt: number,
  ): Promise<void> {
    await this.usage.recordUsage({
      request_id: `${input.request_id}:usage`,
      actor_id: 'agent',
      run_id: input.run_id,
      meter: 'execution',
      unit: 'seconds',
      amount: Math.max(0.001, (Date.now() - startedAt) / 1_000),
      source: targetType === 'customer-managed' ? 'self_hosted' : 'local',
      execution_target_id: input.target_id,
      metadata: {
        operation: input.operation,
        execution_target_type: targetType,
        usage_source: targetType === 'customer-managed' ? 'self_hosted' : 'local',
      },
    });
  }

  private async reserveBudget(
    target: ExecutionTarget,
    input: WorkspaceExecutionRequest,
  ): Promise<BudgetReservation | undefined> {
    if (this.budgets === undefined) return undefined;
    const result = await this.budgets.reserve({
      request_id: `${input.request_id}:budget`,
      actor_id: 'agent',
      run_id: input.run_id,
      scope: 'workspace',
      scope_id: this.context.workspaceId,
      meter: 'execution',
      unit: 'seconds',
      amount: estimatedExecutionSeconds(input),
      policy_decision_id: input.policy_decision_id,
      metadata: {
        execution_target_id: target.id,
        execution_target_type: target.type,
        ...(typeof target.metadata?.['provider'] === 'string' ? { provider: target.metadata['provider'] } : {}),
      },
    });
    if (result.status === 'blocked' || result.status === 'approval_required') {
      throw new ExecutionServiceError(
        ExecutionErrors.codes.EXECUTION_TARGET_UNAVAILABLE,
        result.status === 'blocked'
          ? 'execution is blocked by the Run budget'
          : 'execution requires budget approval',
        { targetId: target.id, reservationId: result.reservation.id, budgetStatus: result.status },
      );
    }
    return result.reservation;
  }

  private async reconcileBudget(
    reservation: BudgetReservation | undefined,
    startedAt: number,
  ): Promise<void> {
    if (reservation === undefined || this.budgets === undefined) return;
    await this.budgets.reconcile({
      request_id: `${reservation.request_id}:reconcile`,
      actor_id: 'system',
      reservation_id: reservation.id,
      actual_amount: Math.max(0.001, (Date.now() - startedAt) / 1_000),
    });
  }

  private async releaseBudget(
    reservation: BudgetReservation | undefined,
  ): Promise<void> {
    if (reservation === undefined || this.budgets === undefined) return;
    await this.budgets.release({
      request_id: `${reservation.request_id}:release`,
      actor_id: 'system',
      reservation_id: reservation.id,
    }).catch(() => undefined);
  }

  private async callWorker(
    endpoint: string,
    credential: string | undefined,
    input: WorkspaceExecutionRequest,
    signal: AbortSignal,
  ): Promise<WorkerResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= WORKER_RETRY_COUNT; attempt += 1) {
      try {
        return await this.callWorkerAttempt(endpoint, credential, input, signal);
      } catch (error) {
        lastError = error;
        if (signal.aborted || !isRetryableWorkerError(error) || attempt === WORKER_RETRY_COUNT) throw error;
        await waitForWorkerRetry(WORKER_RETRY_BACKOFF_MS, attempt, signal);
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new ExecutionServiceError(
      ExecutionErrors.codes.EXECUTION_WORKER_REQUEST_FAILED,
      'worker request failed',
    );
  }

  private async callWorkerAttempt(
    endpoint: string,
    credential: string | undefined,
    input: WorkspaceExecutionRequest,
    signal: AbortSignal,
  ): Promise<WorkerResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);
    const abort = () => controller.abort();
    if (signal.aborted) controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    try {
      const headers = workerHeaders(credential);
      const materializedPayload = await this.materializeInputArtifacts(input.payload);
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            protocol_version: 1,
            workspace_id: this.context.workspaceId,
            run_id: input.run_id,
            request_id: input.request_id,
            target_id: input.target_id,
            lease_id: input.lease_id,
            operation: input.operation,
            // Input bytes are transferred only at the authenticated worker
            // boundary. They are not persisted in Run metadata, events, or
            // execution records; the durable payload remains artifact ids.
            payload: materializedPayload,
            policy_decision_id: input.policy_decision_id,
          }),
        });
      } catch (error) {
        throw new ExecutionServiceError(
          ExecutionErrors.codes.EXECUTION_WORKER_REQUEST_FAILED,
          signal.aborted
            ? 'worker request was cancelled'
            : 'worker request failed: ' + redactError(error, credential),
        );
      }
      const text = await response.text();
      if (text.length > MAX_WORKER_RESPONSE_BYTES) {
        throw new ExecutionServiceError(
          ExecutionErrors.codes.EXECUTION_WORKER_INVALID_RESPONSE,
          'worker response exceeds the maximum supported size',
        );
      }
      if (!response.ok) {
        throw new ExecutionServiceError(
          ExecutionErrors.codes.EXECUTION_WORKER_REQUEST_FAILED,
          'worker returned HTTP ' + response.status + ': ' + redactText(text, credential),
          { status: response.status },
        );
      }
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new ExecutionServiceError(
          ExecutionErrors.codes.EXECUTION_WORKER_INVALID_RESPONSE,
          'worker returned invalid JSON',
        );
      }
      const parsed = workerResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ExecutionServiceError(
          ExecutionErrors.codes.EXECUTION_WORKER_INVALID_RESPONSE,
          'worker response did not match the execution contract',
        );
      }
      return parsed.data;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }

  private async materializeInputArtifacts(
    payload: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<Record<string, unknown>>> {
    const ids = [...new Set(collectArtifactIds(payload))];
    if (ids.length === 0) return payload;
    const inputArtifacts: Array<{
      readonly artifact_id: string;
      readonly name: string;
      readonly kind: string;
      readonly media_type?: string;
      readonly content_base64: string;
    }> = [];
    let totalBytes = 0;
    for (const id of ids) {
      const artifact = await this.artifacts.get(id);
      const download = await this.artifacts.download(id);
      if (artifact === undefined || download === undefined) {
        throw new ExecutionServiceError(
          ExecutionErrors.codes.EXECUTION_ARTIFACT_INVALID,
          'execution payload references an unavailable artifact: ' + id,
          { artifactId: id },
        );
      }
      const bytes = Buffer.from(download.content_base64, 'base64').byteLength;
      totalBytes += bytes;
      if (totalBytes > MAX_WORKER_RESPONSE_BYTES) {
        throw new ExecutionServiceError(
          ExecutionErrors.codes.EXECUTION_ARTIFACT_INVALID,
          'worker input artifacts exceed the maximum transfer size',
        );
      }
      inputArtifacts.push({
        artifact_id: artifact.id,
        name: artifact.name,
        kind: artifact.kind,
        media_type: artifact.media_type,
        content_base64: download.content_base64,
      });
    }
    return { ...payload, input_artifacts: inputArtifacts };
  }

  private async resolveCredential(reference: string | undefined): Promise<string | undefined> {
    if (reference === undefined) return undefined;
    if (!reference.startsWith('secret_')) {
      throw new ExecutionServiceError(
        ExecutionErrors.codes.EXECUTION_SECRET_MATERIAL,
        'execution target credentials must use an opaque secret reference',
      );
    }
    const credential = await this.secrets.get(reference);
    if (credential === undefined) {
      throw new ExecutionServiceError(
        ExecutionErrors.codes.EXECUTION_SECRET_MATERIAL,
        'execution target credential is unavailable',
      );
    }
    return credential;
  }

  /**
   * Workers may return only the output bytes and omit the input lineage. The
   * execution boundary still knows the durable input artifacts from the
   * operation payload, so carry those references into every imported output.
   * This keeps remote training/evaluation artifacts connected to their source
   * dataset/model without trusting arbitrary worker metadata.
   */
  private async declaredSourceArtifactIds(
    payload: Readonly<Record<string, unknown>>,
  ): Promise<readonly string[]> {
    const candidates = collectArtifactIds(payload);
    const ids = [...new Set(candidates)];
    for (const id of ids) {
      const source = await this.artifacts.get(id);
      if (source === undefined || source.workspace_id !== this.context.workspaceId) {
        throw new ExecutionServiceError(
          ExecutionErrors.codes.EXECUTION_ARTIFACT_INVALID,
          'execution payload references an unknown source artifact: ' + id,
          { sourceArtifactId: id },
        );
      }
    }
    return ids;
  }
}

function isRetryableWorkerError(error: unknown): boolean {
  if (!(error instanceof ExecutionServiceError) || error.code !== ExecutionErrors.codes.EXECUTION_WORKER_REQUEST_FAILED) {
    return false;
  }
  const status = error.details?.['status'];
  return status === undefined || (typeof status === 'number' && status >= 500);
}

async function waitForWorkerRetry(
  initialDelayMs: number,
  attempt: number,
  signal: AbortSignal,
): Promise<void> {
  const delayMs = Math.min(30_000, initialDelayMs * (2 ** attempt));
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('worker request was cancelled'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('worker request was cancelled'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function collectArtifactIds(
  value: unknown,
  output: string[] = [],
  key?: string,
  seen = new WeakSet<object>(),
): string[] {
  if (key?.endsWith('_artifact_id') && typeof value === 'string') output.push(value);
  if (key?.endsWith('_artifact_ids') && Array.isArray(value)) {
    for (const item of value) if (typeof item === 'string') output.push(item);
  }
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) return output;
    seen.add(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) collectArtifactIds(item, output, undefined, seen);
  } else if (value !== null && typeof value === 'object') {
    for (const [nestedKey, nested] of Object.entries(value)) {
      collectArtifactIds(nested, output, nestedKey, seen);
    }
  }
  return output;
}

function workerEndpoint(metadata: Readonly<Record<string, unknown>> | undefined): string {
  const value = metadata?.['worker_endpoint'];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ExecutionServiceError(
      ExecutionErrors.codes.EXECUTION_TARGET_UNAVAILABLE,
      'execution target does not define a worker endpoint',
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ExecutionServiceError(
      ExecutionErrors.codes.EXECUTION_TARGET_UNAVAILABLE,
      'execution target worker endpoint is invalid',
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ExecutionServiceError(
      ExecutionErrors.codes.EXECUTION_TARGET_UNAVAILABLE,
      'execution target worker endpoint must use http or https',
    );
  }
  return url.toString();
}

function workerHeaders(credential: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (credential === undefined) return headers;
  headers['authorization'] = 'Bearer ' + credential;
  return headers;
}

function hasCapability(capabilities: readonly string[], operation: string): boolean {
  return capabilities.includes(operation) || capabilities.includes('ml') || capabilities.includes('pipeline');
}

function estimatedExecutionSeconds(input: WorkspaceExecutionRequest): number {
  const value = input.payload['estimated_seconds'];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;
}

function assertSafeMetadata(metadata: Readonly<Record<string, unknown>>): void {
  const path = findSensitivePlatformMetadataPath(metadata);
  if (path !== undefined) {
    throw new ExecutionServiceError(
      ExecutionErrors.codes.EXECUTION_SECRET_MATERIAL,
      "execution payload cannot contain secret material in '" + path + "'",
      { key: path },
    );
  }
}

function assertArtifactDoesNotContainCredential(contentBase64: string, credential: string | undefined): void {
  if (credential === undefined) return;
  let decoded: string;
  try {
    decoded = Buffer.from(contentBase64, 'base64').toString('utf8');
  } catch {
    return;
  }
  if (credentialSecrets(credential).some((secret) => decoded.includes(secret))) {
    throw new ExecutionServiceError(
      ExecutionErrors.codes.EXECUTION_SECRET_MATERIAL,
      'worker returned artifact content containing execution credentials',
    );
  }
}

function sanitizeMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
  credential: string | undefined,
): Record<string, unknown> | undefined {
  if (metadata === undefined) return undefined;
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return credentialSecrets(credential).reduce(
        (current, secret) => current.replaceAll(secret, '[REDACTED]'),
        value,
      );
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, visit(nested)]));
    }
    return value;
  };
  return visit(metadata) as Record<string, unknown>;
}

function redactError(error: unknown, secret: string | undefined): string {
  return redactText(error instanceof Error ? error.message : String(error), secret);
}

function redactText(value: string, secret: string | undefined): string {
  const redacted = credentialSecrets(secret).reduce(
    (current, valueToRedact) => current.replaceAll(valueToRedact, '[REDACTED]'),
    value,
  );
  return redacted
    .replace(/(authorization|api[-_ ]?key|token|password)\s*[:=]\s*[^,\s]+/gi, '$1=[REDACTED]')
    .replace(/\s+/g, ' ')
    .slice(0, 2_000);
}

function credentialSecrets(credential: string | undefined): readonly string[] {
  if (credential === undefined) return [];
  return [credential];
}

function executionFingerprint(input: WorkspaceExecutionRequest): string {
  return createHash('sha256')
    .update(stableJson({
      run_id: input.run_id,
      target_id: input.target_id,
      lease_id: input.lease_id,
      operation: input.operation,
      payload: input.payload,
      policy_decision_id: input.policy_decision_id,
    }))
    .digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`;
  }
  if (value === undefined) return 'undefined';
  return JSON.stringify(value);
}

registerScopedService(
  LifecycleScope.Workspace,
  IWorkspaceExecutionService,
  WorkspaceExecutionService,
  ScopeActivation.OnDemand,
  'execution',
);
