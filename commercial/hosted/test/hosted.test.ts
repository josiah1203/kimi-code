import { describe, expect, it } from 'vitest';

import {
  CloudflareEventHistoryStore,
  CloudflareQueueEventBus,
  CloudflareR2ArtifactStore,
  CloudflareWorkflowAdapter,
} from '../src/cloudflare';
import {
  ModalExecutionAdapter,
  OpenRouterLlmAdapter,
} from '../src/providers';
import { HmacArtifactDownloadSigner } from '../src/signing';
import type { ComputeExecution } from '@spiderbyte/commercial-domain';

class FakeR2Bucket {
  readonly objects = new Map<string, {
    readonly body: ReadableStream<Uint8Array>;
    readonly size: number;
    readonly httpMetadata?: { readonly contentType?: string };
    readonly customMetadata?: Readonly<Record<string, string>>;
  }>();

  async head(key: string) {
    return this.objects.get(key) ?? null;
  }

  async get(key: string) {
    return this.objects.get(key) ?? null;
  }

  async put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream<Uint8Array>,
    options?: {
      readonly httpMetadata?: { readonly contentType?: string };
      readonly customMetadata?: Readonly<Record<string, string>>;
    },
  ) {
    const bytes = value instanceof ReadableStream
      ? new Uint8Array(await new Response(value).arrayBuffer())
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    this.objects.set(key, {
      body: new Response(bytes as unknown as BodyInit).body!,
      size: bytes.byteLength,
      httpMetadata: options?.httpMetadata,
      customMetadata: options?.customMetadata,
    });
    return null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

describe('Cloudflare hosted adapters', () => {
  it('stores content-addressed objects under an organization/workspace scope', async () => {
    const bucket = new FakeR2Bucket();
    const artifacts = new CloudflareR2ArtifactStore(bucket);
    const digest = 'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
    const result = await artifacts.putObject({
      account_id: 'acct_test',
      organization_id: 'org_test',
      workspace_id: 'cws_test',
      object_id: 'hartifact_test',
      content_address: digest,
      media_type: 'text/plain',
      bytes: new TextEncoder().encode('hello'),
    });

    expect(result.object_ref).toContain('r2:tenants/org_test/cws_test/objects/hartifact_test/sha256/');
    expect(bucket.objects.has(result.object_ref.slice('r2:'.length))).toBe(true);
    await expect(artifacts.putObject({
      account_id: 'acct_test',
      organization_id: 'org_test',
      workspace_id: 'cws_test',
      object_id: 'hartifact_bad_digest',
      content_address: `sha256:${'b'.repeat(64)}`,
      bytes: new TextEncoder().encode('hello'),
    })).rejects.toThrow('does not match the uploaded bytes');
    await expect(artifacts.getObject({
      organization_id: 'org_other',
      workspace_id: 'cws_test',
      object_ref: result.object_ref,
    })).rejects.toThrow('outside the requested tenant scope');
    await expect(artifacts.issueDownload({
      organization_id: 'org_test',
      workspace_id: 'cws_test',
      artifact_id: 'hartifact_test',
      expires_at: '2099-01-01T00:00:00.000Z',
    })).rejects.toMatchObject({ code: 'commercial.hosted_artifacts.not_configured' });
  });

  it('publishes durable JSON events and rejects oversized messages before send', async () => {
    const sent: unknown[] = [];
    const queue = new CloudflareQueueEventBus({
      send: async (body) => {
        sent.push(body);
        return {};
      },
    });
    await queue.publish({
      event_id: 'event_test',
      organization_id: 'org_test',
      type: 'run.updated',
      occurred_at: '2026-08-12T12:00:00.000Z',
      payload: { state: 'running' },
    });
    expect(sent).toHaveLength(1);
    await expect(queue.publish({
      event_id: 'event_large',
      organization_id: 'org_test',
      type: 'run.updated',
      occurred_at: '2026-08-12T12:00:00.000Z',
      payload: { value: 'x'.repeat(128 * 1024) },
    })).rejects.toThrow('Cloudflare Queue message limit');
    expect(sent).toHaveLength(1);
  });

  it('reports event history as unavailable without a relational client', async () => {
    const history = new CloudflareEventHistoryStore(undefined);
    expect(history.capability().availability).toBe('not_configured');
    await expect(history.append({
      event_id: 'event_test',
      organization_id: 'org_test',
      type: 'run.updated',
      occurred_at: '2026-08-12T12:00:00.000Z',
      payload: {},
    })).rejects.toMatchObject({ code: 'commercial.hosted_database.not_configured' });
  });

  it('uses the provider request id as the idempotent workflow instance id', async () => {
    const instances = new Map<string, { readonly id: string; readonly state: string }>();
    const workflow = new CloudflareWorkflowAdapter({
      orchestration: {
        create: async ({ id }) => {
          const instance = { id, state: 'running' };
          instances.set(id, instance);
          return {
            id,
            status: async () => ({ status: instance.state }),
            terminate: async () => undefined,
          };
        },
        get: async (id) => {
          const instance = instances.get(id);
          if (instance === undefined) throw new Error('missing workflow');
          return {
            id,
            status: async () => ({ status: instance.state }),
            terminate: async () => undefined,
          };
        },
      },
    });
    await expect(workflow.start({
      workflow_name: 'orchestration',
      id: 'run_test_attempt_1',
      payload: { run_id: 'run_test' },
    })).resolves.toMatchObject({ id: 'run_test_attempt_1', state: 'queued' });
    await expect(workflow.inspect('orchestration', 'run_test_attempt_1')).resolves.toMatchObject({ state: 'running' });
  });

  it('signs and verifies short-lived artifact URLs without exposing the signing secret', async () => {
    const signer = new HmacArtifactDownloadSigner('x'.repeat(32), 'https://api.example.test');
    const url = new URL(await signer.sign({
      organization_id: 'org_test',
      workspace_id: 'cws_test',
      artifact_id: 'hartifact_test',
      expires_at: '2099-01-01T00:00:00.000Z',
    }));
    const verified = await signer.verify({
      path: url.pathname,
      organization_id: url.searchParams.get('organization_id')!,
      workspace_id: url.searchParams.get('workspace_id')!,
      artifact_id: url.searchParams.get('artifact_id')!,
      expires: url.searchParams.get('expires')!,
      signature: url.searchParams.get('signature')!,
    });
    expect(verified).toBe(true);
    expect(url.toString()).not.toContain('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(await signer.verify({
      path: url.pathname,
      organization_id: 'org_other',
      workspace_id: url.searchParams.get('workspace_id')!,
      artifact_id: url.searchParams.get('artifact_id')!,
      expires: url.searchParams.get('expires')!,
      signature: url.searchParams.get('signature')!,
    })).toBe(false);
  });

  it('routes OpenRouter through AI Gateway with server metadata and normalizes usage', async () => {
    let request: Request | undefined;
    const adapter = new OpenRouterLlmAdapter({
      endpoint: 'https://gateway.ai.cloudflare.com/v1/account/gateway/openrouter',
      api_key: 'server-only-openrouter-key',
      fetch: async (input, init) => {
        request = new Request(input, init);
        return Response.json({
          id: 'gen_openrouter_1',
          model: 'openai/gpt-5-mini',
          choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: 4,
            completion_tokens: 2,
            total_tokens: 6,
            prompt_tokens_details: { cached_tokens: 1 },
            cost: 0.00002,
          },
          openrouter_metadata: { strategy: 'direct' },
        }, { headers: { 'x-generation-id': 'generation_1' } });
      },
      estimate_cost: (_input, usage) => ({ currency: 'USD', amount: usage.total_tokens * 0.01, price_book_id: 'test-book' }),
    });

    const completion = await adapter.complete({
      request_id: 'llm_request_1',
      idempotency_key: 'llm_idempotency_1',
      context: {
        account_id: 'acct_test',
        organization_id: 'org_test',
        user_id: 'usr_test',
        workspace_id: 'cws_test',
        project_id: 'project_test',
        run_id: 'run_test',
        attempt_id: 'attempt_test',
        plan: 'team',
      },
      model: 'openai/gpt-5-mini',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(completion.text).toBe('hello');
    expect(completion.usage).toMatchObject({ input_tokens: 4, output_tokens: 2, cached_tokens: 1, total_tokens: 6 });
    expect(completion.usage.provider_cost).toMatchObject({ currency: 'USD', amount: 0.00002 });
    expect(completion.estimated_cost).toMatchObject({ price_book_id: 'test-book' });
    expect(request?.url).toBe('https://gateway.ai.cloudflare.com/v1/account/gateway/openrouter/chat/completions');
    expect(request?.headers.get('authorization')).toBe('Bearer server-only-openrouter-key');
    expect(request?.headers.get('idempotency-key')).toBe('llm_idempotency_1');
    const body = await request!.json() as Record<string, unknown>;
    expect(body['trace']).toMatchObject({ spiderbyte_organization_id: 'org_test', spiderbyte_plan: 'team' });
    expect(JSON.stringify(body)).not.toContain('server-only-openrouter-key');
  });

  it('creates Modal executions only from a provider job reference and survives status lookup through a reference store', async () => {
    const executions = new Map<string, ComputeExecution>();
    const adapter = new ModalExecutionAdapter({
      transport: {
        async submit() {
          return { provider_job_id: 'fc_modal_1', state: 'running' };
        },
        async inspect(providerJobId) {
          expect(providerJobId).toBe('fc_modal_1');
          return { provider_job_id: providerJobId, state: 'succeeded', completed_at: '2026-08-12T12:01:00.000Z', usage: { actual_seconds: 3, gpu_seconds: 3 } };
        },
        async cancel(providerJobId) {
          return { provider_job_id: providerJobId, state: 'canceled', completed_at: '2026-08-12T12:02:00.000Z' };
        },
      },
      resolve_context: async (input) => ({
        account_id: 'acct_test',
        organization_id: input.organization_id,
        workspace_id: input.workspace_id,
        reservation_id: input.reservation_id,
        request_id: input.request_id,
        idempotency_key: input.request_id,
        execution_target: { target: 'modal' },
      }),
      references: { get: async (executionId) => executions.get(executionId) },
      next_execution_id: () => 'exec_modal_1',
    });

    const submitted = await adapter.submit({
      organization_id: 'org_test',
      workspace_id: 'cws_test',
      reservation_id: 'reserve_test',
      request_id: 'modal_request_1',
    });
    executions.set(submitted.id, submitted);
    expect(submitted).toMatchObject({ state: 'running', worker_execution_ref: 'fc_modal_1' });
    await expect(adapter.inspect(submitted.id)).resolves.toMatchObject({ state: 'succeeded', metadata: { modal_usage: { actual_seconds: 3, gpu_seconds: 3 } } });
    await expect(adapter.usage(submitted.id)).resolves.toEqual({ actual_amount: 3, unit: 'seconds' });
    await expect(adapter.cancel({ execution_id: submitted.id, request_id: 'modal_cancel_1' })).resolves.toMatchObject({ state: 'canceled' });
  });
});
