/**
 * `platformModelBinding` domain — adapts the workspace provider runtime to
 * SpiderByte's agent-level model requester contract and owns the active selection.
 * The adapter forwards requests through the governed runtime, which resolves
 * credentials only at the provider boundary and records Run usage. Bound at
 * Agent scope.
 */

import { ulid } from 'ulid';

import { AsyncEventQueue } from '#/_base/asyncEventQueue';
import { Disposable } from '#/_base/di/lifecycle';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { StaticAuthProvider, type Model } from '#/kosong/model/catalog';
import type {
  ModelRequestEvent,
  ModelRequestInput,
  ModelRequestParams,
  ModelRequester,
} from '#/kosong/model/modelRequester';
import { addUsage, type TokenUsage } from '#/kosong/contract/usage';
import { IWorkspaceProviderRuntimeService } from '#/workspace/providerConnections/providerRuntime';
import type { ProviderRuntimeModel } from '#/workspace/providerConnections/providerRuntime';
import { IWorkspacePolicyService } from '#/workspace/policy/policy';
import { ISessionApprovalService } from '#/session/approval/approval';
import { ISessionContext } from '#/session/sessionContext/sessionContext';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { isError2 } from '#/_base/errors/errors';
import { ProviderRuntimeError, ProviderRuntimeErrors } from '#/workspace/providerConnections/runtimeErrors';
import { ISessionRunService } from '#/session/run/run';
import { IWireService } from '#/wire/wire';
import type { PlatformModelSelection as PlatformModelSelectionProjection } from '@spiderbyte/protocol';

import {
  IPlatformModelBindingService,
  type PlatformModelBinding,
  type PlatformModelSelection,
} from './platformModelBinding';
import {
  PlatformModelBindingModel,
  platformModelCleared,
  platformModelSelected,
} from './platformModelBindingOps';

export class PlatformModelBindingService extends Disposable implements IPlatformModelBindingService {
  declare readonly _serviceBrand: undefined;

  private binding: PlatformModelBinding | undefined;
  private selectionValue: PlatformModelSelection | undefined;
  private selectionErrorValue: Error | undefined;
  private requester: PlatformModelRequester | undefined;

  constructor(
    @IWorkspaceProviderRuntimeService private readonly runtime: IWorkspaceProviderRuntimeService,
    @ISessionRunService private readonly runs: ISessionRunService,
    @IWorkspacePolicyService private readonly policy?: IWorkspacePolicyService,
    @ISessionApprovalService private readonly approvals?: ISessionApprovalService,
    @ISessionContext private readonly session?: ISessionContext,
    @IAgentScopeContext private readonly agent?: IAgentScopeContext,
    @IWireService private readonly wire?: IWireService,
  ) {
    super();
    this.selectionValue = this.wire === undefined
      ? undefined
      : selectionFromState(this.wire.getModel(PlatformModelBindingModel));
    if (this.wire !== undefined) {
      this._register(
        this.wire.hooks.onDidRestore.register('platform-model-binding', async (_ctx, next) => {
          await next();
          await this.restorePersistedSelection();
        }),
      );
    }
  }

  current(): PlatformModelBinding | undefined {
    return this.binding;
  }

  selection(): PlatformModelSelection | undefined {
    return this.selectionValue;
  }

  selectionError(): Error | undefined {
    return this.selectionErrorValue;
  }

  selectionProjection(): PlatformModelSelectionProjection | undefined {
    const selection = this.selectionValue;
    if (selection?.model === undefined) return undefined;
    return {
      model_ref: {
        provider_connection_id: selection.connection_id,
        model: selection.model,
      },
      fallback_connection_ids: selection.fallback_connection_ids ?? [],
      policy_decision_id: selection.policy_decision_id,
    };
  }

  getSelection(): PlatformModelSelectionProjection | undefined {
    return this.selectionProjection();
  }

  async selectProjection(
    input: PlatformModelSelectionProjection,
  ): Promise<PlatformModelSelectionProjection> {
    await this.select({
      connection_id: input.model_ref.provider_connection_id,
      model: input.model_ref.model,
      fallback_connection_ids: input.fallback_connection_ids,
      policy_decision_id: input.policy_decision_id,
    });
    return this.selectionProjection() as PlatformModelSelectionProjection;
  }

  async select(input: PlatformModelSelection): Promise<PlatformModelBinding> {
    const descriptor = await this.runtime.describe(input.connection_id, input.model);
    const fallback = [...new Set(
      (input.fallback_connection_ids ?? []).filter((id) => id !== input.connection_id),
    )];
    const policyDecisionId = await this.authorizeSelection(
      descriptor.connection_id,
      descriptor.provider,
      descriptor.model,
      input.policy_decision_id,
      input.run_id,
    );
    const selection: PlatformModelSelection = {
      connection_id: descriptor.connection_id,
      model: descriptor.model,
      run_id: input.run_id,
      fallback_connection_ids: fallback,
      policy_decision_id: policyDecisionId,
    };
    const binding = this.createBinding(descriptor, selection);
    this.selectionValue = selection;
    this.selectionErrorValue = undefined;
    this.binding = binding;
    this.wire?.dispatch(
      platformModelSelected({
        model_ref: {
          provider_connection_id: descriptor.connection_id,
          model: descriptor.model,
        },
        fallback_connection_ids: fallback,
        policy_decision_id: policyDecisionId,
      }),
    );
    return binding;
  }

  attachRun(runId: string | undefined): void {
    if (this.selectionValue === undefined) return;
    this.selectionValue = { ...this.selectionValue, run_id: runId };
    this.requester?.attachRun(runId);
    if (this.binding !== undefined) this.binding = { ...this.binding, run_id: runId };
  }

  clear(): void {
    this.binding = undefined;
    this.requester = undefined;
    this.selectionValue = undefined;
    this.selectionErrorValue = undefined;
    this.wire?.dispatch(platformModelCleared({}));
  }

  private async restorePersistedSelection(): Promise<void> {
    const selection = this.selectionValue;
    if (selection === undefined || selection.model === undefined) return;
    try {
      const descriptor = await this.runtime.describe(selection.connection_id, selection.model);
      this.binding = this.createBinding(descriptor, selection);
      this.selectionErrorValue = undefined;
    } catch (error) {
      // Keep the opaque selection visible so the normal requester fails
      // explicitly instead of silently falling back to the legacy profile.
      this.binding = undefined;
      this.selectionErrorValue = safeSelectionError(error);
    }
  }

  private createBinding(
    descriptor: ProviderRuntimeModel,
    selection: PlatformModelSelection,
  ): PlatformModelBinding {
    const modelDefinition = modelFromRuntime(descriptor);
    const modelAlias = `platform:${descriptor.connection_id}/${descriptor.model}`;
    const requester = new PlatformModelRequester(
      this.runtime,
      this.runs,
      this.policy,
      this.approvals,
      this.session,
      this.agent,
      descriptor.connection_id,
      descriptor.provider,
      descriptor.model,
      selection.run_id,
      selection.policy_decision_id,
      selection.fallback_connection_ids ?? [],
      modelDefinition,
    );
    this.requester = requester;
    return {
      connection_id: descriptor.connection_id,
      provider: descriptor.provider,
      model: descriptor.model,
      model_ref: {
        provider_connection_id: descriptor.connection_id,
        model: descriptor.model,
      },
      model_alias: modelAlias,
      model_definition: modelDefinition,
      requester,
      run_id: selection.run_id,
      fallback_connection_ids: selection.fallback_connection_ids ?? [],
      policy_decision_id: selection.policy_decision_id,
    };
  }

  private async authorizeSelection(
    connectionId: string,
    provider: string,
    model: string,
    suppliedDecisionId: string | undefined,
    runId: string | undefined,
  ): Promise<string | undefined> {
    if (this.policy === undefined || typeof this.policy.evaluate !== 'function') return suppliedDecisionId;
    if (suppliedDecisionId !== undefined) {
      await this.policy.assertUsable(suppliedDecisionId, {
        capability: 'model',
        action: `provider:${provider}:${model}`,
        run_id: runId,
      });
      return suppliedDecisionId;
    }
    const decision = await this.policy.evaluate({
      request_id: `platform:model-selection:${ulid()}`,
      run_id: runId,
      capability: 'model',
      action: `provider:${provider}:${model}`,
      requested_by: 'agent',
      metadata: { provider, model },
    });
    if (decision.outcome === 'deny' || decision.state === 'denied') {
      throw new ProviderRuntimeError(
        ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_POLICY_DENIED,
        decision.reason,
        { connectionId, model, policyDecisionId: decision.id },
      );
    }
    return decision.id;
  }
}

class PlatformModelRequester implements ModelRequester {
  constructor(
    private readonly runtime: IWorkspaceProviderRuntimeService,
    private readonly runs: ISessionRunService,
    private readonly policy: IWorkspacePolicyService | undefined,
    private readonly approvals: ISessionApprovalService | undefined,
    private readonly session: ISessionContext | undefined,
    private readonly agent: IAgentScopeContext | undefined,
    private readonly connectionId: string,
    private readonly providerName: string,
    private readonly modelName: string,
    private runId: string | undefined,
    private readonly initialPolicyDecisionId: string | undefined,
    private readonly fallbackConnectionIds: readonly string[],
    readonly model: Model,
  ) {}

  attachRun(runId: string | undefined): void {
    this.runId = runId;
  }

  request(
    input: ModelRequestInput,
    signal?: AbortSignal,
    params?: ModelRequestParams,
  ): AsyncIterable<ModelRequestEvent> {
    const queue = new AsyncEventQueue<ModelRequestEvent>();
    void this.run(input, signal, params, queue);
    return queue;
  }

  private async run(
    input: ModelRequestInput,
    signal: AbortSignal | undefined,
    params: ModelRequestParams | undefined,
    queue: AsyncEventQueue<ModelRequestEvent>,
  ): Promise<void> {
    let runId = this.runId;
    let ownsRun = false;
    let usage: TokenUsage | undefined;
    const startedAt = Date.now();
    try {
      const parentRun = runId === undefined ? undefined : await this.runs.get(runId);
      // A conversational prompt is the durable root. Provider execution is a
      // child operation so usage, policy, and provider traces remain attached
      // without allowing the provider adapter to complete the root itself.
      if (runId === undefined || parentRun?.metadata?.['kind'] === 'conversation') {
        const run = await this.runs.create({
          request_id: `platform:model:${ulid()}:run`,
          parent_run_id: runId,
          metadata: {
            kind: 'provider_model_request',
            provider_connection_id: this.connectionId,
            model: this.modelName,
            required: true,
          },
        });
        runId = run.id;
        ownsRun = true;
        await this.runs.transition(run.id, {
          request_id: `platform:model:${ulid()}:planning`,
          status: 'planning',
        });
        await this.runs.transition(run.id, {
          request_id: `platform:model:${ulid()}:running`,
          status: 'running',
        });
      }
      const requestBaseId = `platform:model:${ulid()}`;
      let policyDecisionId: string | undefined = this.initialPolicyDecisionId;
      let approvalAttempted = false;
      for (;;) {
        try {
          const stream = await this.runtime.request(this.connectionId, {
            request_id: `${requestBaseId}:request`,
            run_id: runId,
            policy_decision_id: policyDecisionId,
            model: this.modelName,
            fallback_connection_ids: this.fallbackConnectionIds,
            input,
            params,
            signal,
            actor: 'agent',
          });
          for await (const event of stream) {
            if (event.type === 'usage') usage = usage === undefined ? event.usage : addUsage(usage, event.usage);
            queue.push(event);
          }
          break;
        } catch (error) {
          const decisionId = providerPolicyDecisionId(error);
          if (
            decisionId === undefined ||
            !isProviderPolicyRequired(error) ||
            approvalAttempted ||
            runId === undefined ||
            this.policy === undefined ||
            this.approvals === undefined
          ) {
            throw error;
          }
          policyDecisionId = await this.requestProviderApproval(runId, decisionId, error);
          approvalAttempted = true;
        }
      }
      const currentRun = runId === undefined ? undefined : await this.runs.get(runId);
      if (currentRun !== undefined && runId !== undefined) {
        await this.runs.transition(runId, {
          request_id: `platform:model:${ulid()}:succeeded`,
          status: ownsRun ? 'succeeded' : currentRun.status,
          metadata: {
            ...currentRun.metadata,
            provider_connection_id: this.connectionId,
            model: this.modelName,
            duration_ms: Math.max(0, Date.now() - startedAt),
            ...(usage === undefined ? {} : {
              usage: {
                input_tokens: usage.inputOther + usage.inputCacheRead + usage.inputCacheCreation,
                output_tokens: usage.output,
                input_cache_read_tokens: usage.inputCacheRead,
                input_cache_creation_tokens: usage.inputCacheCreation,
              },
            }),
          },
        });
      }
      queue.end();
    } catch (error) {
      const currentRun = runId === undefined ? undefined : await this.runs.get(runId);
      if (currentRun !== undefined && runId !== undefined) {
        await this.runs.transition(runId, {
          request_id: `platform:model:${ulid()}:failed`,
          status: ownsRun ? 'failed' : currentRun.status,
          // ProviderRuntimeService returns a redacted coded failure. Keep the
          // persisted Run projection conservative even if another requester
          // implementation is substituted in a host.
          status_reason: error instanceof Error && 'code' in error
            ? `${String((error as { readonly code: unknown }).code)}: ${error.message}`.slice(0, 2_000)
            : 'provider model request failed',
          metadata: {
            ...currentRun.metadata,
            provider_connection_id: this.connectionId,
            model: this.modelName,
            duration_ms: Math.max(0, Date.now() - startedAt),
          },
        }).catch(() => undefined);
      }
      queue.fail(error);
    }
  }

  private async requestProviderApproval(
    runId: string,
    decisionId: string,
    error: unknown,
  ): Promise<string> {
    const policy = this.policy;
    const approvals = this.approvals;
    if (policy === undefined || approvals === undefined) throw error;
    const decision = await policy.get(decisionId);
    if (
      decision === undefined ||
      decision.capability !== 'model' ||
      decision.action !== `provider:${this.providerName}:${this.modelName}` ||
      (decision.run_id !== undefined && decision.run_id !== runId)
    ) {
      throw error;
    }
    const current = await this.runs.get(runId);
    const policyDecisionIds = [...new Set([...(current?.policy_decision_ids ?? []), decisionId])];
    await this.runs.transition(runId, {
      request_id: `platform:model:${decisionId}:awaiting-approval`,
      status: 'awaiting_approval',
      policy_decision_ids: policyDecisionIds,
      status_reason: error instanceof Error ? error.message.slice(0, 2_000) : 'provider policy approval is required',
      metadata: { policy_decision_id: decisionId },
    });
    const response = await approvals.request({
      id: `platform:model:${decisionId}:approval`,
      sessionId: this.session?.sessionId,
      agentId: this.agent?.agentId,
      toolName: 'Provider',
      action: `Use ${this.providerName} model ${this.modelName}`,
      display: {
        kind: 'generic',
        summary: `Use ${this.providerName} / ${this.modelName} for this model request`,
        detail: { run_id: runId, policy_decision_id: decisionId },
      },
    });
    if (response.decision !== 'approved') {
      await policy.deny(decisionId, {
        request_id: `platform:model:${decisionId}:deny`,
        decided_by: 'user',
        reason: response.feedback ?? 'Provider model access was denied by the user.',
      });
      throw new ProviderRuntimeError(
        ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_POLICY_DENIED,
        response.feedback ?? 'Provider model access was denied by the user.',
        { connectionId: this.connectionId, model: this.modelName, policyDecisionId: decisionId },
      );
    }
    const approved = await policy.approve(decisionId, {
      request_id: `platform:model:${decisionId}:approve`,
      decided_by: 'user',
    });
    if (approved === undefined) throw error;
    await this.runs.transition(runId, {
      request_id: `platform:model:${decisionId}:resume`,
      status: 'running',
      metadata: { policy_decision_id: decisionId },
    });
    return decisionId;
  }
}

function isProviderPolicyRequired(error: unknown): boolean {
  return isError2(error) && error.code === ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_POLICY_REQUIRED;
}

function providerPolicyDecisionId(error: unknown): string | undefined {
  if (!isError2(error)) return undefined;
  for (const key of ['policyDecisionId', 'policy_decision_id']) {
    const value = error.details?.[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function modelFromRuntime(descriptor: ProviderRuntimeModel): Model {
  return {
    id: `platform:${descriptor.connection_id}/${descriptor.model}`,
    name: descriptor.model,
    aliases: [],
    protocol: descriptor.protocol,
    baseUrl: descriptor.base_url,
    headers: descriptor.headers,
    capabilities: descriptor.capabilities,
    maxContextSize: descriptor.max_context_size,
    maxInputSize: descriptor.max_input_size,
    maxOutputSize: descriptor.max_output_size,
    supportEfforts: descriptor.support_efforts,
    defaultEffort: descriptor.default_effort,
    alwaysThinking: false,
    providerType: descriptor.provider_type,
    providerName: descriptor.provider,
    authProvider: new StaticAuthProvider(undefined),
    providerOptions: descriptor.provider_options,
  };
}

registerScopedService(
  LifecycleScope.Agent,
  IPlatformModelBindingService,
  PlatformModelBindingService,
  ScopeActivation.OnScopeCreated,
  'platformModelBinding',
);

function selectionFromState(
  state: Readonly<{
    readonly modelRef?: { readonly provider_connection_id: string; readonly model: string };
    readonly fallbackConnectionIds: readonly string[];
    readonly policyDecisionId?: string;
  }>,
): PlatformModelSelection | undefined {
  if (state.modelRef === undefined) return undefined;
  return {
    connection_id: state.modelRef.provider_connection_id,
    model: state.modelRef.model,
    fallback_connection_ids: state.fallbackConnectionIds,
    policy_decision_id: state.policyDecisionId,
  };
}

function safeSelectionError(error: unknown): Error {
  if (error instanceof ProviderRuntimeError) return error;
  return new Error('The persisted platform provider selection could not be restored.');
}
