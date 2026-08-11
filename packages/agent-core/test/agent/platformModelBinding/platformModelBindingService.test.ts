/**
 * Scenario: an agent-local provider selection routes an ordinary provider model
 * requests through the governed workspace runtime and records a durable Run.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DisposableStore } from '#/_base/di/lifecycle';
import { createServices, type TestInstantiationService } from '#/_base/di/test';
import { createHooks } from '#/hooks';
import { IPlatformModelBindingService } from '#/agent/platformModelBinding/platformModelBinding';
import { PlatformModelBindingService } from '#/agent/platformModelBinding/platformModelBindingService';
import { ISessionRunService } from '#/session/run/run';
import { ISessionApprovalService } from '#/session/approval/approval';
import { IWorkspacePolicyService } from '#/workspace/policy/policy';
import { IWireService, type WireHooks } from '#/wire/wire';
import { ProviderRuntimeError, ProviderRuntimeErrors } from '#/workspace/providerConnections/runtimeErrors';
import {
  IWorkspaceProviderRuntimeService,
  type ProviderRuntimeModel,
} from '#/workspace/providerConnections/providerRuntime';
import type { Run } from '@spiderbyte/protocol';

function runRecord(): Run {
  return {
    id: 'run_provider_request',
    workspace_id: 'wd_test_0123456789ab',
    agent_session_id: 'ses_test',
    request_id: 'request_provider_model',
    status: 'queued',
    created_at: '2026-08-09T00:00:00.000Z',
    updated_at: '2026-08-09T00:00:00.000Z',
  };
}

const descriptor: ProviderRuntimeModel = {
  connection_id: 'connection_anthropic',
  provider: 'anthropic',
  model: 'claude-test',
  protocol: 'anthropic',
  provider_type: 'anthropic',
  base_url: 'https://provider.example.test',
  headers: {},
  capabilities: { tool_use: true } as never,
  max_context_size: 128_000,
};

describe('PlatformModelBindingService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;

  afterEach(() => { disposables.dispose(); });

  it('routes the selected model through the runtime and owns a durable request Run', async () => {
    disposables = new DisposableStore();
    const transitions: string[] = [];
    const transitionInputs: Array<Record<string, unknown>> = [];
    const requests: Array<{ readonly connection_id: string; readonly run_id?: string }> = [];
    let currentRun = runRecord();
    const runs = {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      list: async () => [currentRun],
      get: async () => currentRun,
      create: async () => currentRun,
      transition: async (_id: string, input: { readonly status: Run['status']; readonly metadata?: Record<string, unknown> }) => {
        transitions.push(input.status);
        transitionInputs.push({ ...input });
        currentRun = { ...currentRun, status: input.status };
        return currentRun;
      },
      cancel: async () => currentRun,
      retry: async () => currentRun,
      rerun: async () => currentRun,
      fork: async () => currentRun,
      onDidChange: (() => ({ dispose: () => undefined })) as never,
    } as unknown as ISessionRunService;
    const runtime = {
      describe: async () => descriptor,
      request: async (_connectionId: string, input: { readonly run_id?: string }) => {
        requests.push({ connection_id: descriptor.connection_id, run_id: input.run_id });
        return (async function* () {
          yield {
            type: 'usage' as const,
            usage: { inputOther: 2, inputCacheRead: 0, inputCacheCreation: 0, output: 1 },
          };
        })();
      },
    } as unknown as IWorkspaceProviderRuntimeService;

    ix = createServices(disposables, {
      additionalServices: (reg) => {
        reg.defineInstance(IWorkspaceProviderRuntimeService, runtime);
        reg.defineInstance(ISessionRunService, runs);
        reg.define(IPlatformModelBindingService, PlatformModelBindingService);
      },
    });

    const binding = ix.get(IPlatformModelBindingService);
    const selected = await binding.select({
      connection_id: 'connection_anthropic',
      fallback_connection_ids: ['connection_anthropic', 'connection_openai', 'connection_openai'],
    });
    expect(selected.model_alias).toBe('platform:connection_anthropic/claude-test');
    expect(selected.fallback_connection_ids).toEqual(['connection_openai']);
    expect(JSON.stringify(selected)).not.toContain('secret');

    const events = selected.requester.request({ systemPrompt: 'test', tools: [], messages: [] });
    const received = [];
    for await (const event of events) received.push(event);

    expect(received).toHaveLength(1);
    expect(requests).toEqual([{ connection_id: 'connection_anthropic', run_id: 'run_provider_request' }]);
    expect(transitions).toEqual(['planning', 'running', 'succeeded']);
    expect(transitionInputs.at(-1)).toMatchObject({
      status: 'succeeded',
      metadata: {
        provider_connection_id: 'connection_anthropic',
        model: 'claude-test',
        usage: { input_tokens: 2, output_tokens: 1 },
      },
    });

    binding.clear();
    expect(binding.current()).toBeUndefined();
  });

  it('projects provider policy approval into the session approval flow and retries with the approved decision', async () => {
    disposables = new DisposableStore();
    const transitions: Array<Record<string, unknown>> = [];
    let currentRun = runRecord();
    const runs = {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      list: async () => [currentRun],
      get: async () => currentRun,
      create: async () => currentRun,
      transition: async (_id: string, input: Record<string, unknown>) => {
        transitions.push(input);
        currentRun = { ...currentRun, status: input['status'] as Run['status'] };
        return currentRun;
      },
      cancel: async () => currentRun,
      resume: async () => currentRun,
      retry: async () => currentRun,
      rerun: async () => currentRun,
      fork: async () => currentRun,
      onDidChange: (() => ({ dispose: () => undefined })) as never,
    } as unknown as ISessionRunService;
    let attempts = 0;
    const runtime = {
      describe: async () => descriptor,
      request: async (_connectionId: string, input: { readonly policy_decision_id?: string }) => {
        attempts += 1;
        if (input.policy_decision_id === undefined) {
          throw new ProviderRuntimeError(
            ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_POLICY_REQUIRED,
            'provider approval is required',
            { policyDecisionId: 'policy_provider_approval' },
          );
        }
        return (async function* () {
          yield { type: 'usage' as const, usage: { inputOther: 2, inputCacheRead: 0, inputCacheCreation: 0, output: 1 } };
        })();
      },
    } as unknown as IWorkspaceProviderRuntimeService;
    const approvals = {
      _serviceBrand: undefined,
      request: async (request: { readonly action: string; readonly display: unknown }) => {
        expect(request.action).toContain('claude-test');
        expect(JSON.stringify(request.display)).not.toContain('secret');
        return { decision: 'approved' as const };
      },
      enqueue: vi.fn(),
      decide: vi.fn(),
      listPending: () => [],
    } as unknown as ISessionApprovalService;
    const policy = {
      _serviceBrand: undefined,
      get: async (id: string) => ({
        id,
        run_id: currentRun.id,
        capability: 'model' as const,
        action: 'provider:anthropic:claude-test',
        outcome: 'approval_required' as const,
        state: 'evaluated' as const,
        reason: 'approval required',
      }),
      approve: vi.fn(async () => ({ id: 'policy_provider_approval' })),
      deny: vi.fn(),
    } as unknown as IWorkspacePolicyService;

    ix = createServices(disposables, {
      additionalServices: (reg) => {
        reg.defineInstance(IWorkspaceProviderRuntimeService, runtime);
        reg.defineInstance(ISessionRunService, runs);
        reg.defineInstance(ISessionApprovalService, approvals);
        reg.defineInstance(IWorkspacePolicyService, policy);
        reg.define(IPlatformModelBindingService, PlatformModelBindingService);
      },
    });

    const selected = await ix.get(IPlatformModelBindingService).select({ connection_id: descriptor.connection_id });
    const received = [];
    for await (const event of selected.requester.request({ systemPrompt: 'test', tools: [], messages: [] })) received.push(event);

    expect(received).toHaveLength(1);
    expect(attempts).toBe(2);
    expect(transitions.map((input) => input['status'])).toEqual(['planning', 'running', 'awaiting_approval', 'running', 'succeeded']);
    expect(policy.approve).toHaveBeenCalledWith('policy_provider_approval', expect.objectContaining({ decided_by: 'user' }));
  });

  it('persists a secret-free ModelRef and rehydrates it after an agent restart', async () => {
    disposables = new DisposableStore();
    let state: {
      readonly modelRef?: { readonly provider_connection_id: string; readonly model: string };
      readonly fallbackConnectionIds: readonly string[];
      readonly policyDecisionId?: string;
    } = { fallbackConnectionIds: [] };
    const wire = {
      _serviceBrand: undefined,
      hooks: createHooks<WireHooks, keyof WireHooks>(['onDidRestore']),
      dispatch: (...ops: readonly { readonly type: string; readonly payload: Record<string, unknown> }[]) => {
        for (const op of ops) {
          if (op.type === 'platform.model.selected') {
            const modelRef = op.payload['model_ref'] as { provider_connection_id: string; model: string };
            state = {
              modelRef,
              fallbackConnectionIds: op.payload['fallback_connection_ids'] as readonly string[],
              policyDecisionId: op.payload['policy_decision_id'] as string | undefined,
            };
          } else if (op.type === 'platform.model.cleared') {
            state = { fallbackConnectionIds: [] };
          }
        }
      },
      seal: async () => {},
      restore: async () => {},
      flush: async () => {},
      getModel: () => state,
    } as unknown as IWireService;
    const runs = {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      list: async () => [],
      get: async () => undefined,
      create: async () => runRecord(),
      transition: async () => runRecord(),
      cancel: async () => runRecord(),
      retry: async () => runRecord(),
      rerun: async () => runRecord(),
      fork: async () => runRecord(),
      onDidChange: (() => ({ dispose: () => undefined })) as never,
    } as unknown as ISessionRunService;
    const runtime = {
      describe: async () => descriptor,
    } as unknown as IWorkspaceProviderRuntimeService;

    const makeIx = (): TestInstantiationService => createServices(new DisposableStore(), {
      additionalServices: (reg) => {
        reg.defineInstance(IWorkspaceProviderRuntimeService, runtime);
        reg.defineInstance(ISessionRunService, runs);
        reg.defineInstance(IWireService, wire);
        reg.define(IPlatformModelBindingService, PlatformModelBindingService);
      },
    });

    const first = makeIx();
    await first.get(IPlatformModelBindingService).select({
      connection_id: descriptor.connection_id,
      model: descriptor.model,
      fallback_connection_ids: ['connection_openai'],
    });
    expect(state.modelRef).toEqual({
      provider_connection_id: descriptor.connection_id,
      model: descriptor.model,
    });
    expect(JSON.stringify(state)).not.toContain('secret');
    expect(first.get(IPlatformModelBindingService).selectionProjection()).toMatchObject({
      model_ref: state.modelRef,
      fallback_connection_ids: ['connection_openai'],
    });
    first.dispose();

    const second = makeIx();
    const binding = second.get(IPlatformModelBindingService);
    expect(binding.current()).toBeUndefined();
    await wire.hooks.onDidRestore.run({});
    expect(binding.current()?.model_ref).toEqual(state.modelRef);
    expect(binding.selectionProjection()).toMatchObject({
      model_ref: state.modelRef,
      fallback_connection_ids: ['connection_openai'],
    });
    second.dispose();
  });

  it('links provider execution beneath a conversational root Run', async () => {
    disposables = new DisposableStore();
    const root: Run = {
      ...runRecord(),
      id: 'run_conversation_root',
      metadata: { kind: 'conversation' },
    };
    const child: Run = {
      ...runRecord(),
      id: 'run_provider_child',
      parent_run_id: root.id,
      metadata: { kind: 'provider_model_request' },
    };
    const createdInputs: Array<Record<string, unknown>> = [];
    const requestRunIds: Array<string | undefined> = [];
    let current = root;
    const runs = {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      list: async () => [current],
      get: async (id: string) => id === root.id ? root : current.id === id ? current : undefined,
      create: async (input: Record<string, unknown>) => {
        createdInputs.push(input);
        current = child;
        return child;
      },
      transition: async (_id: string, input: { readonly status: Run['status']; readonly metadata?: Record<string, unknown> }) => {
        current = { ...current, status: input.status, metadata: { ...current.metadata, ...input.metadata } };
        return current;
      },
      cancel: async () => current,
      retry: async () => current,
      rerun: async () => current,
      fork: async () => current,
      onDidChange: (() => ({ dispose: () => undefined })) as never,
    } as unknown as ISessionRunService;
    const runtime = {
      describe: async () => descriptor,
      request: async (_connectionId: string, input: { readonly run_id?: string }) => {
        requestRunIds.push(input.run_id);
        return (async function* () {
          yield { type: 'usage' as const, usage: { inputOther: 1, inputCacheRead: 0, inputCacheCreation: 0, output: 1 } };
        })();
      },
    } as unknown as IWorkspaceProviderRuntimeService;
    ix = createServices(disposables, {
      additionalServices: (reg) => {
        reg.defineInstance(IWorkspaceProviderRuntimeService, runtime);
        reg.defineInstance(ISessionRunService, runs);
        reg.define(IPlatformModelBindingService, PlatformModelBindingService);
      },
    });
    const selected = await ix.get(IPlatformModelBindingService).select({
      connection_id: descriptor.connection_id,
      model: descriptor.model,
      run_id: root.id,
    });
    for await (const _event of selected.requester.request({ systemPrompt: 'test', tools: [], messages: [] })) {
      // consume the stream so the child Run settles
    }

    expect(createdInputs).toHaveLength(1);
    expect(createdInputs[0]).toMatchObject({
      parent_run_id: root.id,
      metadata: {
        kind: 'provider_model_request',
        provider_connection_id: descriptor.connection_id,
        model: descriptor.model,
      },
    });
    expect(requestRunIds).toEqual([child.id]);
  });
});
