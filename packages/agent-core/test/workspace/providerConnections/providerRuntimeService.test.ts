/**
 * Scenario: provider connections cross the secure runtime boundary.
 * Responsibilities: credentials become opaque references, validation uses the
 * existing kosong requester, and remote model discovery returns capability
 * metadata without exposing the credential. External network and storage are
 * stubbed; the runtime service itself is the SUT.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IProtocolAdapterRegistry } from '#/kosong/protocol/protocol';
import type { IPlatformSecretStore } from '#/app/secrets/platformSecretStore';
import type { IWorkspaceProviderConnectionService } from '#/workspace/providerConnections/providerConnection';
import type { IWorkspacePolicyService } from '#/workspace/policy/policy';
import type { IWorkspaceUsageService } from '#/workspace/usage/usage';
import type { IWorkspacePlatformEventService } from '#/workspace/platformEvents/platformEvents';
import { WorkspaceProviderRuntimeService } from '#/workspace/providerConnections/providerRuntimeService';
import '#/kosong/provider/providers/standard.contrib';
import { PLATFORM_NO_CREDENTIAL_SECRET_REF, type ProviderConnection } from '@spiderbyte/protocol';

function connection(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    id: 'connection_openai',
    workspace_id: 'wd_test_0123456789ab',
    name: 'OpenAI',
    provider: 'openai',
    scope: 'workspace',
    state: 'configured',
    secret_ref: 'secret_existing',
    capabilities: ['chat'],
    created_at: '2026-08-08T00:00:00.000Z',
    updated_at: '2026-08-08T00:00:00.000Z',
    metadata: { model: 'gpt-test', base_url: 'https://provider.example.test/v1' },
    ...overrides,
  };
}

function protocols(transientFailures = 0): IProtocolAdapterRegistry {
  let remainingFailures = transientFailures;
  return {
    _serviceBrand: undefined,
    supportedProtocols: () => ['openai', 'anthropic', 'openai_responses', 'google-genai'],
    resolveAdapterIdentity: () => ({ baseId: 'openai', traits: [] }),
    resolveProviderBaseId: () => 'openai',
    resolveCapability: () => ({ tool_use: true } as never),
    explainCapability: () => ({ capability: { tool_use: true } as never, source: { kind: 'none', detail: 'test' } }),
    createChatProvider: (config) => ({
      name: 'openai',
      modelName: 'gpt-test',
      thinkingEffort: null,
      async generate(_systemPrompt, _tools, _history, options) {
        if (remainingFailures > 0) {
          remainingFailures -= 1;
          throw new Error('temporary provider outage');
        }
        if (options?.auth?.apiKey === 'sk-first-fails') throw new Error('first provider unavailable');
        if (options?.auth?.apiKey === 'sk-secret-error') {
          throw new Error(`provider rejected key ${options.auth.apiKey}`);
        }
        return {
          id: 'response_test',
          usage: { inputOther: 2, output: 1, inputCacheRead: 0, inputCacheCreation: 0 },
          finishReason: 'completed',
          rawFinishReason: null,
          async *[Symbol.asyncIterator]() {
            yield { type: 'text', text: 'pong' };
          },
        };
      },
    }),
  };
}

function runtime(options: {
  readonly current?: ProviderConnection;
  readonly connections?: readonly ProviderConnection[];
  readonly createResult?: ProviderConnection;
  readonly policyOutcome?: 'allow' | 'deny' | 'approval_required';
  readonly transientFailures?: number;
} = {}): {
  readonly service: WorkspaceProviderRuntimeService;
  readonly removed: string[];
  readonly policy: IWorkspacePolicyService;
  readonly usage: IWorkspaceUsageService;
  readonly events: IWorkspacePlatformEventService;
  readonly secrets: IPlatformSecretStore;
} {
  let current = options.current ?? connection();
  const available = options.connections ?? [current];
  const removed: string[] = [];
  const secrets: IPlatformSecretStore = {
    _serviceBrand: undefined,
    ready: Promise.resolve(),
    put: vi.fn(async () => 'secret_new'),
    set: vi.fn(async () => undefined),
    get: vi.fn(async (ref: string) =>
      ref === 'secret_first' ? 'sk-first-fails' :
        ref === 'secret_second' ? 'sk-second-works' :
          ref === 'secret_error' ? 'sk-secret-error' :
          ref === 'secret_existing' || ref === 'secret_new' ? 'sk-test-secret' : undefined),
    remove: vi.fn(async (ref: string) => { removed.push(ref); }),
  };
  const connections: IWorkspaceProviderConnectionService = {
    _serviceBrand: undefined,
    ready: Promise.resolve(),
    onDidChange: (() => ({ dispose: () => {} })) as never,
    list: async () => available,
    get: async (id) => available.find((candidate) => candidate.id === id) ?? current,
    create: async (input) => options.createResult ?? connection({ secret_ref: input.secret_ref }),
    update: async (_id, input) => {
      current = connection({ ...current, secret_ref: input.secret_ref ?? current.secret_ref });
      return current;
    },
    validate: async () => current,
    activate: async () => current,
    revoke: async () => {
      current = connection({ ...current, state: 'revoked', revoked_at: '2026-08-08T00:00:01.000Z' });
      return current;
    },
    discoverModels: async () => undefined,
  };
  const policy = {
    _serviceBrand: undefined,
    evaluate: vi.fn(async () => ({
      id: 'policy_provider_test',
      capability: 'model',
      outcome: options.policyOutcome ?? 'allow',
      state: 'evaluated',
      reason: 'test policy',
    })),
    assertUsable: vi.fn(async (id: string, input: { readonly action: string }) => {
      if (id === 'policy_first' && input.action === 'provider:anthropic:claude-test') {
        throw new Error('primary provider decision cannot authorize fallback provider');
      }
      return {
        id,
        capability: 'model',
        outcome: 'allow',
        state: 'approved',
        reason: 'test policy',
        action: input.action,
      };
    }),
    get: vi.fn(async () => undefined),
  } as unknown as IWorkspacePolicyService;
  const usage = {
    _serviceBrand: undefined,
    recordUsage: vi.fn(async (input) => input),
  } as unknown as IWorkspaceUsageService;
  const events = {
    _serviceBrand: undefined,
    ready: Promise.resolve(),
    onDidChange: (() => ({ dispose: () => {} })) as never,
    append: vi.fn(async (input) => ({
      ...input,
      event_id: 'event_provider_test',
      workspace_id: 'wd_test_0123456789ab',
      sequence: 1,
      occurred_at: '2026-08-08T00:00:00.000Z',
    })),
    replay: vi.fn(async () => ({ events: [], next_sequence: 0, has_more: false })),
  } as unknown as IWorkspacePlatformEventService;
  return {
    service: new WorkspaceProviderRuntimeService(connections, secrets, protocols(options.transientFailures), policy, usage, events),
    removed,
    policy,
    usage,
    events,
    secrets,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('WorkspaceProviderRuntimeService', () => {
  it('resolves OpenRouter through the OpenAI transport with its managed default endpoint', async () => {
    const openrouter = connection({
      id: 'connection_openrouter',
      name: 'OpenRouter managed',
      provider: 'openrouter',
      metadata: { model: 'openai/gpt-4o-mini' },
    });
    const { service } = runtime({ current: openrouter, connections: [openrouter] });

    await expect(service.describe(openrouter.id)).resolves.toMatchObject({
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
      protocol: 'openai',
      provider_type: 'openrouter',
      base_url: 'https://openrouter.ai/api/v1',
    });
  });

  it('keeps a newly supplied credential opaque and cleans up an idempotent duplicate', async () => {
    const { service, removed } = runtime({ createResult: connection({ secret_ref: 'secret_existing' }) });
    const created = await service.createConnection({
      request_id: 'provider_create',
      name: 'OpenAI',
      provider: 'openai',
      scope: 'workspace',
      secret: 'sk-test-secret',
      capabilities: ['chat'],
      metadata: { model: 'gpt-test', base_url: 'https://provider.example.test/v1' },
    });

    expect(created.secret_ref).toBe('secret_existing');
    expect(removed).toEqual(['secret_new']);
    expect(JSON.stringify(created)).not.toContain('sk-test-secret');
  });

  it('validates through kosong and discovers remote models with capabilities', async () => {
    const { service, usage, events } = runtime();
    const descriptor = await service.describe('connection_openai');
    expect(descriptor).toMatchObject({
      connection_id: 'connection_openai',
      provider: 'openai',
      model: 'gpt-test',
      base_url: 'https://provider.example.test/v1',
    });
    expect(JSON.stringify(descriptor)).not.toContain('sk-test-secret');

    const response = await service.validate('connection_openai', undefined, {
      request_id: 'provider_validate',
      run_id: 'run_provider_validate',
    });
    expect(response).toMatchObject({ connection_id: 'connection_openai', ok: true, text: 'pong' });
    expect(response.usage).toMatchObject({ output: 1 });
    expect(usage.recordUsage).toHaveBeenCalledWith(expect.objectContaining({
      run_id: 'run_provider_validate',
      meter: 'intelligence',
      unit: 'intelligence_percent',
    }));
    expect(events.append).toHaveBeenCalledWith(expect.objectContaining({
      entity_id: 'connection_openai',
      state: 'runtime_requesting',
    }));

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: 'gpt-remote', object: 'model' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const discovered = await service.discoverModels('connection_openai', { force_remote: true });
    expect(discovered.models).toMatchObject([{ id: 'gpt-remote', capabilities: ['tool_use'] }]);
    expect(JSON.stringify(discovered)).not.toContain('sk-test-secret');
  });

  it('supports an unauthenticated local endpoint without resolving a secret', async () => {
    const local = connection({
      id: 'connection_local',
      provider: 'local',
      secret_ref: PLATFORM_NO_CREDENTIAL_SECRET_REF,
      metadata: { model: 'local-model', base_url: 'http://127.0.0.1:1234/v1' },
    });
    const { service, secrets } = runtime({ current: local, connections: [local] });

    const stream = await service.request('connection_local', {
      request_id: 'provider_local_request',
      input: {
        systemPrompt: 'test',
        tools: [],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }], toolCalls: [] }],
      },
    });
    const parts: string[] = [];
    for await (const event of stream) {
      if (event.type === 'part' && event.part.type === 'text') parts.push(event.part.text);
    }
    expect(parts.join('')).toBe('pong');
    expect(secrets.get).not.toHaveBeenCalled();
  });

  it('enforces model policy before constructing a provider requester', async () => {
    const { service } = runtime({ policyOutcome: 'deny' });
    await expect(service.request('connection_openai', {
      request_id: 'provider_request_denied',
      run_id: 'run_provider_denied',
      input: {
        systemPrompt: 'test',
        tools: [],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }], toolCalls: [] }],
      },
    })).rejects.toMatchObject({ code: 'provider_runtime.policy_denied' });
  });

  it('routes to an ordered fallback before any model output is emitted', async () => {
    const first = connection({ id: 'connection_first', secret_ref: 'secret_first', metadata: { model: 'gpt-test', base_url: 'https://provider.example.test/v1' } });
    const second = connection({ id: 'connection_second', secret_ref: 'secret_second', metadata: { model: 'gpt-test', base_url: 'https://provider.example.test/v1' } });
    const { service } = runtime({ connections: [first, second] });
    const events = await service.request('connection_first', {
      request_id: 'provider_fallback',
      fallback_connection_ids: ['connection_second'],
      input: {
        systemPrompt: 'test',
        tools: [],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }], toolCalls: [] }],
      },
    });
    const parts = [];
    for await (const event of events) {
      if (event.type === 'part' && event.part.type === 'text') parts.push(event.part.text);
    }
    expect(parts.join('')).toBe('pong');
  });

  it('retries a transient provider failure before using a fallback', async () => {
    const { service, events } = runtime({ transientFailures: 1 });
    const stream = await service.request('connection_openai', {
      request_id: 'provider_retry',
      retry_count: 1,
      retry_backoff_ms: 0,
      input: {
        systemPrompt: 'test',
        tools: [],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }], toolCalls: [] }],
      },
    });
    const parts: string[] = [];
    for await (const event of stream) {
      if (event.type === 'part' && event.part.type === 'text') parts.push(event.part.text);
    }
    expect(parts.join('')).toBe('pong');
    expect(events.append).toHaveBeenCalledWith(expect.objectContaining({ state: 'runtime_failed' }));
    expect(events.append).toHaveBeenCalledWith(expect.objectContaining({ state: 'runtime_completed' }));
  });

  it('re-evaluates governance for a fallback with a different provider or model', async () => {
    const first = connection({
      id: 'connection_first',
      secret_ref: 'secret_first',
      metadata: { model: 'gpt-test', base_url: 'https://provider.example.test/v1' },
    });
    const second = connection({
      id: 'connection_second',
      provider: 'anthropic',
      secret_ref: 'secret_second',
      metadata: { model: 'claude-test', base_url: 'https://provider.example.test/v1' },
    });
    const { service, policy } = runtime({ connections: [first, second] });
    const events = await service.request('connection_first', {
      request_id: 'provider_fallback_policy',
      policy_decision_id: 'policy_first',
      fallback_connection_ids: ['connection_second'],
      input: {
        systemPrompt: 'test',
        tools: [],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }], toolCalls: [] }],
      },
    });
    const parts: string[] = [];
    for await (const event of events) {
      if (event.type === 'part' && event.part.type === 'text') parts.push(event.part.text);
    }
    expect(parts.join('')).toBe('pong');
    expect(policy.assertUsable).toHaveBeenCalledTimes(1);
    expect(policy.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'provider:anthropic:claude-test',
    }));
  });

  it('rethrows provider failures with secret-free coded errors', async () => {
    const leaking = connection({ id: 'connection_error', secret_ref: 'secret_error' });
    const { service } = runtime({ current: leaking });
    const stream = await service.request('connection_error', {
      request_id: 'provider_secret_error',
      input: {
        systemPrompt: 'test',
        tools: [],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }], toolCalls: [] }],
      },
    });

    let failure: unknown;
    try {
      for await (const _event of stream) {
        // The provider fails before emitting output.
      }
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'provider_runtime.request_failed' });
    expect(String(failure)).not.toContain('sk-secret-error');
  });
});
