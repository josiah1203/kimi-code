/**
 * `providerConnections` domain — `IWorkspaceProviderRuntimeService`
 * implementation.
 *
 * Reads the durable connection projection, resolves credentials through the
 * App-scoped platform secret store only at the provider boundary, and builds
 * Kimi `kosong` requesters from typed connection metadata. Bound at Workspace
 * scope; provider calls are not persisted here, while callers persist Run,
 * usage, artifact, and audit projections through their owning services.
 */

import { Disposable } from '#/_base/di/lifecycle';
import { ulid } from 'ulid';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import {
  IProtocolAdapterRegistry,
  ProtocolSchema,
  type Protocol,
  type ProtocolProviderOptions,
} from '#/kosong/protocol/protocol';
import { StaticAuthProvider, type Model } from '#/kosong/model/catalog';
import { ModelRequesterImpl } from '#/kosong/model/modelRequesterImpl';
import type { ModelRequestEvent } from '#/kosong/model/modelRequester';
import type { Message, StreamedMessagePart } from '#/kosong/contract/message';
import {
  explainProviderEndpoint,
  getProviderDefinition,
} from '#/kosong/provider/providerDefinition';
import { IPlatformSecretStore } from '#/app/secrets/platformSecretStore';
import { IWorkspacePolicyService } from '#/workspace/policy/policy';
import { IWorkspaceUsageService } from '#/workspace/usage/usage';
import { IWorkspaceBudgetService } from '#/workspace/budgets/budget';
import { IWorkspacePlatformEventService } from '#/workspace/platformEvents/platformEvents';
import { IWorkspaceProviderConnectionService } from './providerConnection';
import {
  IWorkspaceProviderRuntimeService,
  type ProviderRuntimeOperationOptions,
  type ProviderRuntimeModel,
  type ProviderRuntimeRequest,
  type ProviderRuntimeValidationResult,
} from './providerRuntime';
import {
  ProviderRuntimeErrors,
  ProviderRuntimeError,
  type ProviderRuntimeErrorCode,
} from './runtimeErrors';
import {
  nowIsoDateTime,
  PLATFORM_NO_CREDENTIAL_SECRET_REF,
  providerModelDiscoverySchema,
  providerModelSchema,
  type ProviderConnection,
  type ProviderConnectionCommandInput,
  type ProviderConnectionCreateWithSecretInput,
  type ProviderConnectionUpdateWithSecretInput,
  type ProviderModel,
  type ProviderModelDiscovery,
  type BudgetReservation,
} from '@moonshot-ai/protocol';
import type { PolicyDecision } from '@moonshot-ai/protocol';
import { grandTotal, type TokenUsage } from '#/kosong/contract/usage';

const DEFAULT_MAX_CONTEXT = 128_000;
const MAX_DISCOVERY_BYTES = 2 * 1024 * 1024;

export class WorkspaceProviderRuntimeService
  extends Disposable
  implements IWorkspaceProviderRuntimeService
{
  declare readonly _serviceBrand: undefined;

  constructor(
    @IWorkspaceProviderConnectionService
    private readonly connections: IWorkspaceProviderConnectionService,
    @IPlatformSecretStore private readonly secrets: IPlatformSecretStore,
    @IProtocolAdapterRegistry private readonly protocols: IProtocolAdapterRegistry,
    @IWorkspacePolicyService private readonly policy: IWorkspacePolicyService,
    @IWorkspaceUsageService private readonly usage: IWorkspaceUsageService,
    @IWorkspacePlatformEventService private readonly events: IWorkspacePlatformEventService,
    @IWorkspaceBudgetService private readonly budgets?: IWorkspaceBudgetService,
  ) {
    super();
  }

  async createConnection(input: ProviderConnectionCreateWithSecretInput): Promise<ProviderConnection> {
    const secret = await this.secrets.put(input.secret);
    try {
      const { secret: _secret, ...connectionInput } = input;
      const connection = await this.connections.create({ ...connectionInput, secret_ref: secret });
      // A retried request may return the original durable connection. Never
      // leave the newly supplied credential orphaned in that idempotent path.
      if (connection.secret_ref !== secret) await this.secrets.remove(secret);
      return connection;
    } catch (error) {
      await this.secrets.remove(secret);
      throw error;
    }
  }

  async updateConnectionSecret(
    connectionId: string,
    input: ProviderConnectionUpdateWithSecretInput,
  ): Promise<ProviderConnection | undefined> {
    const current = await this.connections.get(connectionId);
    if (current === undefined) return undefined;
    const secret = await this.secrets.put(input.secret);
    try {
      const { secret: _secret, ...patch } = input;
      const next = await this.connections.update(connectionId, {
        ...patch,
        secret_ref: secret,
      });
      if (next === undefined || next.secret_ref !== secret) {
        await this.secrets.remove(secret);
      }
      if (next !== undefined && next.secret_ref !== current.secret_ref && next.secret_ref === secret) {
        await this.secrets.remove(current.secret_ref);
      }
      return next;
    } catch (error) {
      await this.secrets.remove(secret);
      throw error;
    }
  }

  async revokeConnection(
    connectionId: string,
    input: ProviderConnectionCommandInput,
  ): Promise<ProviderConnection | undefined> {
    const current = await this.connections.get(connectionId);
    if (current === undefined) return undefined;
    const next = await this.connections.revoke(connectionId, input);
    if (next !== undefined) await this.secrets.remove(current.secret_ref);
    return next;
  }

  async validate(
    connectionId: string,
    model?: string,
    options: ProviderRuntimeOperationOptions = {},
  ): Promise<ProviderRuntimeValidationResult> {
    const startedAt = Date.now();
    const connection = await this.requireConnection(connectionId);
    const selectedModel = selectedModelFor(connection, model);
    let policyDecision: PolicyDecision | undefined;
    let resolvedSecret: string | undefined;
    try {
      policyDecision = await this.authorize(connection, selectedModel, options);
      const resolved = await this.resolve(connection, selectedModel);
      resolvedSecret = resolved.secret;
      await this.traceProviderRequest(connection, resolved.model, options, 'requesting');
      let text = '';
      let usage: TokenUsage | undefined;
      const requester = this.requester(resolved);
      for await (const event of requester.request({
        systemPrompt: 'You are a connectivity probe. Answer with the single word "pong".',
        tools: [],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }], toolCalls: [] }],
      }, options.signal, { maxCompletionTokens: 32 })) {
        if (event.type === 'part' && event.part.type === 'text') text += event.part.text;
        if (event.type === 'usage') usage = event.usage;
      }
      await this.recordUsage(connection, resolved.model, usage, options);
      await this.traceProviderRequest(connection, resolved.model, {
        ...options,
        policy_decision_id: policyDecision.id,
      }, 'completed', undefined, {
        duration_ms: Math.max(0, Date.now() - startedAt),
        usage,
      });
      return {
        connection_id: connection.id,
        model: resolved.model,
        ok: true,
        duration_ms: Math.max(0, Date.now() - startedAt),
        text: redactSecret(text.trim(), resolvedSecret),
        usage,
        policy_decision_id: policyDecision.id,
      };
    } catch (error) {
      await this.traceProviderRequest(connection, selectedModel, {
        ...options,
        policy_decision_id: policyDecision?.id,
      }, 'failed', redactError(error, resolvedSecret), {
        duration_ms: Math.max(0, Date.now() - startedAt),
      });
      return {
        connection_id: connection.id,
        model: selectedModel,
        ok: false,
        duration_ms: Math.max(0, Date.now() - startedAt),
        policy_decision_id: policyDecision?.id,
        error: redactError(error, resolvedSecret),
      };
    }
  }

  async discoverModels(
    connectionId: string,
    options: { readonly force_remote?: boolean } & ProviderRuntimeOperationOptions = {},
  ): Promise<ProviderModelDiscovery> {
    const connection = await this.requireConnection(connectionId);
    const configured = configuredModels(connection);
    const selectedModel = configured[0]?.id ?? 'model_catalog';
    await this.authorize(connection, selectedModel, options);
    const metadata = connection.metadata ?? {};
    if (configured.length > 0 && options.force_remote !== true && metadata['discover_models'] !== true) {
      return providerModelDiscoverySchema.parse({
        connection_id: connection.id,
        models: configured,
        discovered_at: nowIsoDateTime(),
      });
    }

    const resolved = await this.resolve(connection, configured[0]?.id);
    const secret = resolved.secret;
    if (secret === undefined && !allowsUnauthenticated(connection)) {
      throw new ProviderRuntimeError(
        ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_SECRET_MISSING,
        `provider connection has no stored credential: ${connection.id}`,
        { connectionId: connection.id },
      );
    }
    const endpoint = discoveryEndpoint(resolved.baseUrl, resolved.protocol);
    if (endpoint === undefined) {
      if (configured.length > 0) {
        return providerModelDiscoverySchema.parse({
          connection_id: connection.id,
          models: configured,
          discovered_at: nowIsoDateTime(),
        });
      }
      throw new ProviderRuntimeError(
        ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_UNSUPPORTED,
        `provider ${connection.provider} does not expose a discoverable model catalog`,
        { connectionId: connection.id },
      );
    }
    try {
      const response = await fetch(endpoint, {
        headers: discoveryHeaders(resolved.protocol, secret),
        signal: options.signal,
      });
      if (!response.ok) {
        throw new Error(`provider returned HTTP ${response.status}`);
      }
      const length = Number(response.headers.get('content-length') ?? 0);
      if (length > MAX_DISCOVERY_BYTES) throw new Error('provider model catalog is too large');
      const payload = (await response.json()) as unknown;
      const models = parseDiscoveredModels(
        payload,
        resolved.protocol,
        resolved.providerType,
        this.protocols,
      );
      return providerModelDiscoverySchema.parse({
        connection_id: connection.id,
        models,
        discovered_at: nowIsoDateTime(),
      });
    } catch (error) {
      throw new ProviderRuntimeError(
        ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_DISCOVERY_FAILED,
        `failed to discover models for provider connection ${connection.id}: ${redactError(error, secret)}`,
        { connectionId: connection.id },
      );
    }
  }

  async describe(connectionId: string, model?: string): Promise<ProviderRuntimeModel> {
    const connection = await this.requireConnection(connectionId);
    const descriptor = this.describeConnection(connection, model);
    return {
      connection_id: connection.id,
      provider: connection.provider,
      model: descriptor.model,
      protocol: descriptor.protocol,
      provider_type: descriptor.providerType,
      base_url: descriptor.baseUrl,
      headers: descriptor.modelDefinition.headers,
      capabilities: descriptor.modelDefinition.capabilities,
      max_context_size: descriptor.modelDefinition.maxContextSize,
      max_input_size: descriptor.modelDefinition.maxInputSize,
      max_output_size: descriptor.modelDefinition.maxOutputSize,
      support_efforts: descriptor.modelDefinition.supportEfforts,
      default_effort: descriptor.modelDefinition.defaultEffort,
      provider_options: descriptor.modelDefinition.providerOptions,
    };
  }

  async request(
    connectionId: string,
    request: ProviderRuntimeRequest,
  ): Promise<AsyncIterable<ModelRequestEvent>> {
    const connectionIds = [...new Set([connectionId, ...(request.fallback_connection_ids ?? [])])];
    return this.requestWithFallback(connectionIds, request);
  }

  private async requestWithFallback(
    connectionIds: readonly string[],
    request: ProviderRuntimeRequest,
  ): Promise<AsyncIterable<ModelRequestEvent>> {
    if (connectionIds.length === 0) {
      throw new ProviderRuntimeError(
        ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_CONNECTION_NOT_FOUND,
        'no provider connection was supplied',
      );
    }
    // Authorize and resolve the primary connection before returning. This
    // preserves the runtime's fail-fast governance contract while allowing
    // transport failures to fall through during iteration.
    const first = await this.prepareRequest(connectionIds[0]!, request, 0);
    await this.traceProviderRequest(first.connection, first.resolved.model, {
      ...request,
      policy_decision_id: first.policyDecision.id,
    }, 'requesting');
    return this.fallbackStream(connectionIds, request, first);
  }

  private async prepareRequest(
    connectionId: string,
    request: ProviderRuntimeRequest,
    index: number,
  ): Promise<PreparedProviderRequest> {
    const connection = await this.requireConnection(connectionId);
    const selectedModel = selectedModelFor(connection, request.model);
    const policyRequestId = request.request_id === undefined
      ? undefined
      : `${request.request_id}:provider:${index}`;
    const policyDecision = await this.authorize(connection, selectedModel, {
      ...request,
      request_id: policyRequestId,
    });
    const resolved = await this.resolve(connection, selectedModel);
    const budgetReservation = await this.reserveBudget(connection, selectedModel, request);
    return {
      connection,
      resolved,
      policyDecision,
      budgetReservation,
      stream: this.requester(resolved).request(request.input, request.signal, request.params),
    };
  }

  private async *fallbackStream(
    connectionIds: readonly string[],
    request: ProviderRuntimeRequest,
    first: PreparedProviderRequest,
  ): AsyncIterable<ModelRequestEvent> {
    let lastError: ProviderRuntimeError | undefined;
    const retryCount = boundedRetryCount(request.retry_count);
    const retryBackoffMs = boundedRetryBackoff(request.retry_backoff_ms);
    for (const [index, candidateId] of connectionIds.entries()) {
      let emitted = false;
      for (let attempt = 0; attempt <= retryCount; attempt += 1) {
        let prepared: PreparedProviderRequest | undefined;
        const attemptStartedAt = Date.now();
        let usage: TokenUsage | undefined;
        try {
          // Policy decisions are scoped to the provider/model action that was
          // authorized. A fallback may resolve to a different provider or model,
          // so it must evaluate its own decision rather than reusing the
          // primary connection's decision id.
          const candidateRequest = index === 0
            ? request
            : { ...request, policy_decision_id: undefined };
          prepared = index === 0 && attempt === 0
            ? first
            : await this.prepareRequest(candidateId, candidateRequest, index);
          if (index > 0 || attempt > 0) {
            await this.traceProviderRequest(prepared.connection, prepared.resolved.model, {
              ...request,
              policy_decision_id: prepared.policyDecision.id,
            }, 'requesting');
          }
          for await (const event of this.observeRequest(prepared.stream, prepared.connection, prepared.resolved.model, prepared.resolved.secret, {
            ...request,
            policy_decision_id: prepared.policyDecision.id,
          }, (nextUsage) => {
            usage = nextUsage;
          })) {
            emitted = true;
            yield event;
          }
          await this.traceProviderRequest(prepared.connection, prepared.resolved.model, {
            ...request,
            policy_decision_id: prepared.policyDecision.id,
          }, 'completed', undefined, {
            duration_ms: Math.max(0, Date.now() - attemptStartedAt),
            usage,
          });
          await this.reconcileBudget(prepared.budgetReservation, request, usage);
          return;
        } catch (error) {
          const safeError = safeProviderRequestError(error, prepared?.resolved.secret);
          lastError = safeError;
          await this.releaseOrReconcileBudget(prepared?.budgetReservation, request, usage);
          if (prepared !== undefined) {
            await this.traceProviderRequest(
              prepared.connection,
              prepared.resolved.model,
              { ...request, policy_decision_id: prepared.policyDecision.id },
              'failed',
              safeError.message,
              { duration_ms: Math.max(0, Date.now() - attemptStartedAt), usage },
            );
          }
          // Never bypass governance or configuration failures with a fallback
          // or a retry. Resilience applies only to transport/request failures.
          const retryable = !emitted && isRetryableProviderFailure(safeError);
          if (request.signal?.aborted === true) throw safeError;
          if (retryable && attempt < retryCount) {
            await waitForProviderRetry(retryBackoffMs, attempt, request.signal);
            continue;
          }
          if (emitted || !retryable || index === connectionIds.length - 1) {
            throw safeError;
          }
          break;
        }
      }
    }
    if (lastError !== undefined) throw lastError;
  }

  async secretReference(connectionId: string) {
    const connection = await this.connections.get(connectionId);
    return connection?.secret_ref;
  }

  private async requireConnection(connectionId: string): Promise<ProviderConnection> {
    const connection = await this.connections.get(connectionId);
    if (connection === undefined) {
      throw new ProviderRuntimeError(
        ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_CONNECTION_NOT_FOUND,
        `provider connection not found: ${connectionId}`,
        { connectionId },
      );
    }
    if (connection.state === 'revoked') {
      throw new ProviderRuntimeError(
        ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_INVALID_CONFIGURATION,
        `provider connection is revoked: ${connectionId}`,
        { connectionId },
      );
    }
    return connection;
  }

  private async authorize(
    connection: ProviderConnection,
    model: string,
    options: ProviderRuntimeOperationOptions,
  ): Promise<PolicyDecision> {
    const requestId = options.request_id ?? `provider_policy_${ulid()}`;
    const decision = options.policy_decision_id === undefined
      ? await this.policy.evaluate({
        request_id: requestId,
        run_id: options.run_id,
        capability: 'model',
        action: `provider:${connection.provider}:${model}`,
        requested_by: options.actor ?? 'agent',
        metadata: { connection_id: connection.id, model },
      })
      : await this.policy.assertUsable(options.policy_decision_id, {
        capability: 'model',
        action: `provider:${connection.provider}:${model}`,
        run_id: options.run_id,
      });
    if (decision === undefined) {
      throw new ProviderRuntimeError(
        ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_POLICY_REQUIRED,
        'provider model policy decision is unavailable',
        { connectionId: connection.id, model },
      );
    }
    if (decision.capability !== 'model' || decision.outcome === 'deny' || decision.state === 'denied') {
      throw new ProviderRuntimeError(
        ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_POLICY_DENIED,
        decision.reason,
        { connectionId: connection.id, model, policyDecisionId: decision.id },
      );
    }
    if (
      decision.outcome === 'approval_required' &&
      decision.state !== 'approved' &&
      decision.state !== 'audited'
    ) {
      throw new ProviderRuntimeError(
        ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_POLICY_REQUIRED,
        decision.reason,
        { connectionId: connection.id, model, policyDecisionId: decision.id },
      );
    }
    return decision;
  }

  private async recordUsage(
    connection: ProviderConnection,
    model: string,
    usage: TokenUsage | undefined,
    options: ProviderRuntimeOperationOptions,
  ): Promise<void> {
    if (options.run_id === undefined || usage === undefined) return;
    const tokens = grandTotal(usage);
    const amount = tokens === 0 ? 0 : Math.max(0.01, tokens / 100_000);
    await this.usage.recordUsage({
      request_id: `${options.request_id ?? `provider_usage_${ulid()}`}:usage`,
      actor_id: options.actor ?? 'agent',
      run_id: options.run_id,
      meter: isManagedConnection(connection) ? 'managed_llm' : 'intelligence',
      unit: isManagedConnection(connection) ? 'units' : 'intelligence_percent',
      amount,
      source: providerUsageSource(connection),
      metadata: {
        provider: connection.provider,
        connection_id: connection.id,
        model,
        usage_source: providerUsageSource(connection),
        input_tokens: usage.inputOther + usage.inputCacheRead + usage.inputCacheCreation,
        output_tokens: usage.output,
      },
    });
  }

  private async reserveBudget(
    connection: ProviderConnection,
    model: string,
    options: ProviderRuntimeOperationOptions,
  ): Promise<BudgetReservation | undefined> {
    if (this.budgets === undefined || options.run_id === undefined || !isManagedConnection(connection)) {
      return undefined;
    }
    const result = await this.budgets.reserve({
      request_id: `${options.request_id ?? `provider_${ulid()}`}:budget`,
      actor_id: options.actor ?? 'agent',
      run_id: options.run_id,
      scope: 'run',
      scope_id: options.run_id,
      meter: 'managed_llm',
      unit: 'units',
      amount: estimatedProviderUnits(connection),
      policy_decision_id: options.policy_decision_id,
      metadata: { provider: connection.provider, connection_id: connection.id, model },
    });
    if (result.status === 'blocked') {
      throw new ProviderRuntimeError(
        ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_POLICY_DENIED,
        'provider request is blocked by the Run budget',
        { connectionId: connection.id, model, reservationId: result.reservation.id },
      );
    }
    if (result.status === 'approval_required') {
      throw new ProviderRuntimeError(
        ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_POLICY_REQUIRED,
        'provider request requires budget approval',
        { connectionId: connection.id, model, reservationId: result.reservation.id },
      );
    }
    return result.reservation;
  }

  private async reconcileBudget(
    reservation: BudgetReservation | undefined,
    options: ProviderRuntimeOperationOptions,
    usage: TokenUsage | undefined,
  ): Promise<void> {
    if (reservation === undefined || this.budgets === undefined) return;
    const tokens = usage === undefined ? 0 : grandTotal(usage);
    await this.budgets.reconcile({
      request_id: `${reservation.request_id}:reconcile`,
      actor_id: options.actor ?? 'system',
      reservation_id: reservation.id,
      actual_amount: tokens,
    });
  }

  private async releaseOrReconcileBudget(
    reservation: BudgetReservation | undefined,
    options: ProviderRuntimeOperationOptions,
    usage: TokenUsage | undefined,
  ): Promise<void> {
    if (reservation === undefined || this.budgets === undefined) return;
    if (usage !== undefined) {
      await this.reconcileBudget(reservation, options, usage).catch(() => undefined);
      return;
    }
    await this.budgets.release({
      request_id: `${reservation.request_id}:release`,
      actor_id: options.actor ?? 'system',
      reservation_id: reservation.id,
    }).catch(() => undefined);
  }

  /**
   * Persist a compact, replayable provider trace without copying request
   * content, response payloads, or credential material into the event log.
   * Tracing is observability only; a journal failure must never change model
   * execution semantics.
   */
  private async traceProviderRequest(
    connection: ProviderConnection,
    model: string,
    options: ProviderRuntimeOperationOptions,
    state: 'requesting' | 'completed' | 'failed',
    error?: string,
    details?: { readonly duration_ms?: number; readonly usage?: TokenUsage },
  ): Promise<void> {
    await this.events.append({
      event_type: `provider_connection.state_changed`,
      entity_type: 'provider_connection',
      entity_id: connection.id,
      request_id: options.request_id,
      actor: options.actor ?? 'agent',
      state: `runtime_${state}`,
      payload: {
        model,
        ...(options.run_id === undefined ? {} : { run_id: options.run_id }),
        ...(options.policy_decision_id === undefined ? {} : { policy_decision_id: options.policy_decision_id }),
        ...(error === undefined ? {} : { error: error.slice(0, 2_000) }),
        ...(details?.duration_ms === undefined ? {} : { duration_ms: details.duration_ms }),
        ...(details?.usage === undefined ? {} : {
          usage: {
            input_tokens: details.usage.inputOther + details.usage.inputCacheRead + details.usage.inputCacheCreation,
            output_tokens: details.usage.output,
          },
        }),
      },
    }).catch(() => undefined);
  }

  private async *observeRequest(
    stream: AsyncIterable<ModelRequestEvent>,
    connection: ProviderConnection,
    model: string,
    secret: string | undefined,
    options: ProviderRuntimeOperationOptions,
    onUsage?: (usage: TokenUsage) => void,
  ): AsyncIterable<ModelRequestEvent> {
    let usage: TokenUsage | undefined;
    for await (const event of stream) {
      if (event.type === 'usage') usage = event.usage;
      yield redactProviderEvent(event, secret);
    }
    if (usage !== undefined) onUsage?.(usage);
    await this.recordUsage(connection, model, usage, options);
  }

  private async resolve(connection: ProviderConnection, requestedModel?: string): Promise<ResolvedProvider> {
    const descriptor = this.describeConnection(connection, requestedModel);
    const secret = connection.secret_ref === PLATFORM_NO_CREDENTIAL_SECRET_REF
      ? undefined
      : await this.secrets.get(connection.secret_ref);
    if (secret === undefined && !allowsUnauthenticated(connection)) {
      throw new ProviderRuntimeError(
        ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_SECRET_MISSING,
        `provider connection ${connection.id} references an unavailable credential`,
        { connectionId: connection.id },
      );
    }
    return {
      ...descriptor,
      secret,
      modelDefinition: {
        ...descriptor.modelDefinition,
        authProvider: new StaticAuthProvider(secret),
        providerOptions: {
          ...descriptor.modelDefinition.providerOptions,
          allowUnauthenticated: allowsUnauthenticated(connection) ? true : undefined,
        },
      },
    };
  }

  private describeConnection(
    connection: ProviderConnection,
    requestedModel?: string,
  ): Omit<ResolvedProvider, 'secret'> {
    const metadata = connection.metadata ?? {};
    const protocol = resolveProtocol(connection, metadata);
    const providerType = resolveProviderType(connection, metadata, protocol);
    const model = requestedModel ?? stringMetadata(metadata, 'default_model') ?? stringMetadata(metadata, 'model') ?? configuredModels(connection)[0]?.id;
    if (model === undefined || model.trim().length === 0) {
      throw new ProviderRuntimeError(
        ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_INVALID_CONFIGURATION,
        `provider connection ${connection.id} does not define a model`,
        { connectionId: connection.id },
      );
    }
    const baseUrl = stringMetadata(metadata, 'base_url') ?? explainProviderEndpoint(providerType, {}).baseUrl;
    if (baseUrl !== undefined) validateBaseUrl(baseUrl, connection.id);
    const capabilities = this.protocols.resolveCapability(protocol, model, providerType);
    const maxContextSize = positiveNumberMetadata(metadata, 'max_context_size') ?? DEFAULT_MAX_CONTEXT;
    const supportEfforts = stringArrayMetadata(metadata, 'support_efforts');
    const defaultEffort = stringMetadata(metadata, 'default_effort');
    const headers = stringRecordMetadata(metadata, 'headers');
    const providerOptions = metadata['provider_options'];
    return {
      connection,
      model,
      protocol,
      providerType,
      baseUrl,
      modelDefinition: {
        id: `${connection.id}:${model}`,
        name: model,
        aliases: [],
        protocol,
        baseUrl,
        headers,
        capabilities,
        maxContextSize,
        maxInputSize: positiveNumberMetadata(metadata, 'max_input_size'),
        maxOutputSize: positiveNumberMetadata(metadata, 'max_output_size'),
        supportEfforts,
        defaultEffort,
        alwaysThinking: false,
        providerType,
        providerName: connection.provider,
        authProvider: new StaticAuthProvider(undefined),
        providerOptions: isRecord(providerOptions)
          ? (providerOptions as ProtocolProviderOptions)
          : undefined,
      },
    };
  }

  private requester(resolved: ResolvedProvider): ModelRequesterImpl {
    return new ModelRequesterImpl(resolved.modelDefinition, this.protocols);
  }
}

interface ResolvedProvider {
  readonly connection: ProviderConnection;
  readonly model: string;
  readonly protocol: Protocol;
  readonly providerType: string;
  readonly baseUrl?: string;
  readonly secret?: string;
  readonly modelDefinition: Model;
}

interface PreparedProviderRequest {
  readonly connection: ProviderConnection;
  readonly resolved: ResolvedProvider;
  readonly policyDecision: PolicyDecision;
  readonly budgetReservation?: BudgetReservation;
  readonly stream: AsyncIterable<ModelRequestEvent>;
}

function resolveProtocol(connection: ProviderConnection, metadata: Readonly<Record<string, unknown>>): Protocol {
  const explicit = ProtocolSchema.safeParse(metadata['protocol']);
  if (explicit.success) return explicit.data;
  // Provider identity is resolved by kosong's definition registry.  The
  // platform connection enum deliberately names a few deployment aliases
  // (`google`, `openai-compatible`, and `local`), so only those aliases that
  // have no exact definition use the canonical protocol fallback.
  const definition = getProviderDefinition(connection.provider);
  if (definition !== undefined) return definition.baseProtocol;
  const protocol = ProtocolSchema.safeParse(connection.provider);
  if (protocol.success) return protocol.data;
  if (connection.provider === 'google') return 'google-genai';
  if (connection.provider === 'custom') {
    throw new ProviderRuntimeError(
      ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_INVALID_CONFIGURATION,
      `custom provider connection ${connection.id} must declare a supported protocol`,
      { connectionId: connection.id },
    );
  }
  return 'openai';
}

function resolveProviderType(
  connection: ProviderConnection,
  metadata: Readonly<Record<string, unknown>>,
  protocol: Protocol,
): string {
  const explicit = stringMetadata(metadata, 'provider_type');
  if (explicit !== undefined) return explicit;
  if (connection.provider === 'google') return 'google-genai';
  if (connection.provider === 'openai-compatible') return 'openai-compatible';
  return connection.provider === 'custom' ? protocol : connection.provider;
}

function configuredModels(connection: ProviderConnection): ProviderModel[] {
  const raw = connection.metadata?.['models'];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (typeof value === 'string') return [{ id: value, capabilities: [] }];
    const parsed = providerModelSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

function stringMetadata(metadata: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function positiveNumberMetadata(metadata: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;
}

function stringArrayMetadata(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] | undefined {
  const value = metadata[key];
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return entries.length === 0 ? undefined : entries.map((item) => item.trim());
}

function stringRecordMetadata(metadata: Readonly<Record<string, unknown>>, key: string): Readonly<Record<string, string>> {
  const value = metadata[key];
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateBaseUrl(baseUrl: string, connectionId: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ProviderRuntimeError(
      ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_INVALID_CONFIGURATION,
      `provider connection ${connectionId} has an invalid base URL`,
      { connectionId },
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProviderRuntimeError(
      ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_INVALID_CONFIGURATION,
      `provider connection ${connectionId} must use an http or https base URL`,
      { connectionId },
    );
  }
}

function discoveryEndpoint(baseUrl: string | undefined, protocol: Protocol): string | undefined {
  if (baseUrl === undefined) return undefined;
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/$/, '');
  if (path.endsWith('/models')) return url.toString();
  if (protocol === 'google-genai') {
    url.pathname = `${path}/v1beta/models`.replaceAll(/\/+/g, '/');
  } else {
    url.pathname = `${path}/models`.replaceAll(/\/+/g, '/');
  }
  return url.toString();
}

function discoveryHeaders(protocol: Protocol, secret: string | undefined): Record<string, string> {
  if (secret === undefined) return {};
  if (protocol === 'anthropic') {
    return { 'x-api-key': secret, 'anthropic-version': '2023-06-01' };
  }
  if (protocol === 'google-genai') {
    return { 'x-goog-api-key': secret };
  }
  return { authorization: `Bearer ${secret}` };
}

function parseDiscoveredModels(
  payload: unknown,
  protocol: Protocol,
  providerType: string,
  protocols: IProtocolAdapterRegistry,
): ProviderModel[] {
  const raw = isRecord(payload)
    ? Array.isArray(payload['data'])
      ? payload['data']
      : Array.isArray(payload['models'])
        ? payload['models']
        : []
    : [];
  return raw.flatMap((value) => {
    if (!isRecord(value) || typeof value['id'] !== 'string' && typeof value['name'] !== 'string') return [];
    const id = typeof value['id'] === 'string' ? value['id'] : String(value['name']).replace(/^models\//, '');
    const capabilities = protocols.resolveCapability(protocol, id, providerType);
    return [{
      id,
      name: typeof value['name'] === 'string' ? value['name'] : undefined,
      capabilities: Object.entries(capabilities)
        .filter(([, enabled]) => enabled === true)
        .map(([name]) => name),
      metadata: { source: 'provider' },
    }];
  });
}

function selectedModelFor(connection: ProviderConnection, requestedModel?: string): string {
  const model = requestedModel
    ?? stringMetadata(connection.metadata ?? {}, 'default_model')
    ?? stringMetadata(connection.metadata ?? {}, 'model')
    ?? configuredModels(connection)[0]?.id;
  if (model === undefined || model.trim().length === 0) {
    throw new ProviderRuntimeError(
      ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_INVALID_CONFIGURATION,
      `provider connection ${connection.id} does not define a model`,
      { connectionId: connection.id },
    );
  }
  return model;
}

function allowsUnauthenticated(connection: ProviderConnection): boolean {
  return connection.provider === 'local' && connection.secret_ref === PLATFORM_NO_CREDENTIAL_SECRET_REF;
}

function isManagedConnection(connection: ProviderConnection): boolean {
  return connection.metadata?.['billing_source'] === 'managed' || connection.metadata?.['managed'] === true;
}

function providerUsageSource(connection: ProviderConnection): 'managed' | 'byok' | 'local' {
  if (connection.provider === 'local') return 'local';
  return isManagedConnection(connection) ? 'managed' : 'byok';
}

function estimatedProviderUnits(connection: ProviderConnection): number {
  const value = connection.metadata?.['estimated_units'];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;
}

function redactError(error: unknown, secret?: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return (secret === undefined ? message : message.replaceAll(secret, '[REDACTED]'))
    .replaceAll(/(authorization|api[-_ ]?key|token|password)\s*[:=]\s*[^,\s]+/gi, '$1=[REDACTED]')
    .slice(0, 2_000);
}

function safeProviderRequestError(error: unknown, secret?: string): ProviderRuntimeError {
  const message = redactError(error, secret);
  if (error instanceof ProviderRuntimeError) {
    return new ProviderRuntimeError(error.code as ProviderRuntimeErrorCode, message);
  }
  return new ProviderRuntimeError(
    ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_REQUEST_FAILED,
    `provider request failed: ${message}`,
  );
}

function redactSecret(value: string, secret: string | undefined): string {
  return secret === undefined || secret.length === 0 ? value : value.replaceAll(secret, '[REDACTED]');
}

function redactProviderEvent(event: ModelRequestEvent, secret: string | undefined): ModelRequestEvent {
  if (event.type === 'part') return { ...event, part: redactPart(event.part, secret) };
  if (event.type === 'finish') return { ...event, message: redactMessage(event.message, secret) };
  return event;
}

function redactPart(part: StreamedMessagePart, secret: string | undefined): StreamedMessagePart {
  if (part.type === 'text') return { ...part, text: redactSecret(part.text, secret) };
  if (part.type === 'think') return {
    ...part,
    think: redactSecret(part.think, secret),
    encrypted: part.encrypted === undefined ? undefined : redactSecret(part.encrypted, secret),
  };
  if (part.type === 'function') return {
    ...part,
    arguments: part.arguments === null ? null : redactSecret(part.arguments, secret),
  };
  if (part.type === 'tool_call_part') return {
    ...part,
    argumentsPart: part.argumentsPart === null ? null : redactSecret(part.argumentsPart, secret),
  };
  return part;
}

function redactMessage(message: Message, secret: string | undefined): Message {
  return {
    ...message,
    content: message.content.map((part) => redactPart(part, secret) as Message['content'][number]),
    toolCalls: message.toolCalls.map((call) => ({
      ...call,
      arguments: call.arguments === null ? null : redactSecret(call.arguments, secret),
    })),
  };
}

function isRetryableProviderFailure(error: unknown): boolean {
  if (!(error instanceof ProviderRuntimeError)) return true;
  const nonRetryable = new Set<string>([
    ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_CONNECTION_NOT_FOUND,
    ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_INVALID_CONFIGURATION,
    ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_SECRET_MISSING,
    ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_UNSUPPORTED,
    ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_POLICY_REQUIRED,
    ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_POLICY_DENIED,
  ]);
  return !nonRetryable.has(error.code);
}

function boundedRetryCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(3, Math.max(0, Math.trunc(value)));
}

function boundedRetryBackoff(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 250;
  return Math.min(30_000, Math.max(0, Math.trunc(value)));
}

async function waitForProviderRetry(
  initialDelayMs: number,
  attempt: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  const delayMs = Math.min(30_000, initialDelayMs * (2 ** attempt));
  if (delayMs === 0) return;
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new Error('provider request was cancelled'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('provider request was cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

registerScopedService(
  LifecycleScope.Workspace,
  IWorkspaceProviderRuntimeService,
  WorkspaceProviderRuntimeService,
  ScopeActivation.OnDemand,
  'providerConnections',
);
