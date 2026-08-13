import {
  assertSafeMetadata,
  capabilityStatusSchema,
  computeExecutionSchema,
  nowIsoDateTime,
  type CapabilityStatus,
  type ComputeExecution,
  type OrganizationId,
  type WorkspaceId,
} from '@spiderbyte/commercial-domain';
import {
  CapabilityUnavailableError,
  type ExecutionTarget,
  type HostedComputeAdapter,
  type HostedComputeUsage,
  type LLMCompletion,
  type LLMCostEstimate,
  type LLMProvider,
  type LLMProviderFactoryOptions,
  type LLMRequest,
  type LLMStreamEvent,
  type LLMUsage,
} from '@spiderbyte/commercial-ports';

const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 5_000;

export interface OpenRouterAdapterOptions extends LLMProviderFactoryOptions {
  /** AI Gateway endpoint ending in `/openrouter` or the complete chat-completions URL. */
  readonly endpoint: string;
  readonly fetch?: typeof fetch;
  readonly max_attempts?: number;
  readonly retry_delay_ms?: number;
  /** Server-owned pricing/reconciliation hook. Client input never supplies a cost. */
  readonly estimate_cost?: (input: LLMRequest, usage: LLMUsage) => LLMCostEstimate | undefined;
}

/** Normalized provider failure. The original response body is intentionally not retained. */
export class OpenRouterProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'OpenRouterProviderError';
  }
}

/**
 * OpenRouter through Cloudflare AI Gateway.
 *
 * Credentials are resolved only inside this adapter. The request contract remains provider
 * neutral and the response exposes provider-reported usage as reconciliation input, not as a
 * billing authority.
 */
export class OpenRouterLlmAdapter implements LLMProvider {
  readonly provider_name = 'openrouter';
  private readonly endpoint: string;
  private readonly fetcher: typeof fetch;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;

  constructor(private readonly options: OpenRouterAdapterOptions) {
    this.endpoint = chatCompletionsEndpoint(options.endpoint);
    this.fetcher = options.fetch ?? fetch;
    this.maxAttempts = boundedAttempts(options.max_attempts);
    this.retryDelayMs = boundedRetryDelay(options.retry_delay_ms);
  }

  capability(): CapabilityStatus {
    const configured = isHttpsUrl(this.endpoint) && (
      this.options.api_key !== undefined ||
      this.options.secrets !== undefined && this.options.secret_ref !== undefined
    );
    return capabilityStatusSchema.parse({
      capability: 'managed_llm',
      availability: configured ? 'available' : 'not_configured',
      adapter: 'openrouter-through-cloudflare-ai-gateway',
      reason: configured
        ? 'OpenRouter requests are routed through the configured Cloudflare AI Gateway endpoint'
        : 'AI Gateway endpoint or server-side OpenRouter credential is not configured',
      checked_at: nowIsoDateTime(),
    });
  }

  async complete(input: LLMRequest): Promise<LLMCompletion> {
    const models = uniqueModels(input.model, input.fallback_models);
    let lastError: unknown;
    for (const model of models) {
      try {
        const response = await this.request(input, model, false);
        return await this.decodeCompletion(input, model, response);
      } catch (error) {
        lastError = error;
        if (!(error instanceof OpenRouterProviderError) || !error.retryable) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('OpenRouter request failed');
  }

  async *stream(input: LLMRequest): AsyncIterable<LLMStreamEvent> {
    const models = uniqueModels(input.model, input.fallback_models);
    let lastError: unknown;
    for (const model of models) {
      try {
        yield* this.streamModel(input, model);
        return;
      } catch (error) {
        lastError = error;
        if (!(error instanceof OpenRouterProviderError) || !error.retryable) {
          yield providerErrorEvent(error);
          return;
        }
      }
    }
    yield providerErrorEvent(lastError);
  }

  private async *streamModel(input: LLMRequest, model: string): AsyncIterable<LLMStreamEvent> {
    const response = await this.request(input, model, true);
    if (response.body === null) throw new OpenRouterProviderError('openrouter.empty_stream', 'OpenRouter returned an empty stream');
    const providerRequestId = response.headers.get('x-request-id') ?? undefined;
    const generationId = response.headers.get('x-generation-id') ?? undefined;
    let text = '';
    let finishReason: string | undefined;
    let usage = emptyUsage();
    let providerResponse: Readonly<Record<string, unknown>> | undefined;
    let providerMetadata: Readonly<Record<string, unknown>> | undefined;
    let completed = false;

    for await (const data of sseData(response.body)) {
      if (data === '[DONE]') {
        completed = true;
        break;
      }
      const record = parseJsonRecord(data, 'OpenRouter stream event');
      if (record['error'] !== undefined) throw providerErrorFromBody(record['error'], 200);
      providerResponse = record;
      providerMetadata = asRecord(record['openrouter_metadata']);
      const choice = firstRecord(record['choices']);
      const delta = asRecord(choice?.['delta']);
      const deltaText = textFromContent(delta?.['content']);
      if (deltaText !== '') {
        text += deltaText;
        yield { type: 'delta', text: deltaText };
      }
      const finish = choice?.['finish_reason'];
      if (typeof finish === 'string') finishReason = finish;
      usage = parseUsage(record['usage'], usage);
    }

    const completion: LLMCompletion = {
      request_id: input.request_id,
      provider: this.provider_name,
      model,
      provider_request_id: providerRequestId,
      generation_id: generationId,
      text,
      finish_reason: finishReason,
      usage,
      estimated_cost: this.options.estimate_cost?.(input, usage),
      provider_metadata: providerMetadata,
      provider_response: providerResponse,
    };
    // Some compatible gateways close without [DONE]. The final normalized event is still
    // emitted after the stream is fully consumed, while the `completed` flag documents that
    // this was a clean SSE terminator when present.
    void completed;
    yield { type: 'completed', completion };
  }

  private async decodeCompletion(input: LLMRequest, model: string, response: Response): Promise<LLMCompletion> {
    const textBody = await response.text();
    const record = parseJsonRecord(textBody, 'OpenRouter response');
    if (record['error'] !== undefined) throw providerErrorFromBody(record['error'], response.status);
    const choice = firstRecord(record['choices']);
    const message = asRecord(choice?.['message']);
    const content = textFromContent(message?.['content']);
    const usage = parseUsage(record['usage'], emptyUsage());
    const finishReason = typeof choice?.['finish_reason'] === 'string' ? choice['finish_reason'] as string : undefined;
    return {
      request_id: input.request_id,
      provider: this.provider_name,
      model,
      provider_request_id: typeof record['id'] === 'string' ? record['id'] : response.headers.get('x-request-id') ?? undefined,
      generation_id: response.headers.get('x-generation-id') ?? undefined,
      text: content,
      finish_reason: finishReason,
      usage,
      estimated_cost: this.options.estimate_cost?.(input, usage),
      provider_metadata: asRecord(record['openrouter_metadata']),
      provider_response: record,
    };
  }

  private async request(input: LLMRequest, model: string, stream: boolean): Promise<Response> {
    const apiKey = await this.resolveApiKey(input.context.organization_id);
    const metadata = requestMetadata(input);
    assertSafeMetadata(metadata);
    const body: Record<string, unknown> = {
      ...(input.parameters ?? {}),
      model,
      messages: input.messages,
      stream,
      user: input.context.user_id,
      provider: input.provider,
      trace: {
        trace_id: input.context.run_id ?? input.request_id,
        trace_name: 'spiderbyte-commercial-llm',
        span_name: input.context.attempt_id ?? input.request_id,
        spiderbyte_account_id: input.context.account_id,
        spiderbyte_organization_id: input.context.organization_id,
        spiderbyte_user_id: input.context.user_id,
        spiderbyte_workspace_id: input.context.workspace_id,
        spiderbyte_project_id: input.context.project_id,
        spiderbyte_run_id: input.context.run_id,
        spiderbyte_attempt_id: input.context.attempt_id,
        spiderbyte_plan: input.context.plan,
      },
    };
    const { signal, cleanup } = requestSignal(input.signal, input.timeout_ms);
    try {
      let attempt = 0;
      let lastError: unknown;
      while (attempt < this.maxAttempts) {
        attempt += 1;
        try {
          const response = await this.fetcher(this.endpoint, {
            method: 'POST',
            headers: {
              accept: stream ? 'text/event-stream' : 'application/json',
              'content-type': 'application/json',
              authorization: `Bearer ${apiKey}`,
              'X-OpenRouter-Metadata': 'enabled',
              'Idempotency-Key': input.idempotency_key,
              'cf-aig-event-id': input.idempotency_key,
              'cf-aig-metadata': JSON.stringify(metadata),
              'cf-aig-request-timeout': String(input.timeout_ms ?? 120_000),
              'cf-aig-max-attempts': String(this.maxAttempts),
              'cf-aig-backoff': 'exponential',
              'cf-aig-retry-delay': String(this.retryDelayMs),
              'cf-aig-collect-log-payload': 'false',
            },
            body: JSON.stringify(body),
            signal,
          });
          if (response.ok) return response;
          const error = await providerErrorFromResponse(response);
          lastError = error;
          if (!error.retryable || attempt >= this.maxAttempts) throw error;
          await wait(retryDelay(error, attempt, this.retryDelayMs));
        } catch (error) {
          if (isAbortError(error)) throw error;
          lastError = error;
          if (!(error instanceof OpenRouterProviderError) || !error.retryable || attempt >= this.maxAttempts) throw error;
          await wait(retryDelay(error, attempt, this.retryDelayMs));
        }
      }
      throw lastError instanceof Error ? lastError : new Error('OpenRouter request failed');
    } finally {
      cleanup();
    }
  }

  private async resolveApiKey(organizationId: OrganizationId): Promise<string> {
    if (this.options.api_key !== undefined) return this.options.api_key;
    if (this.options.secrets === undefined || this.options.secret_ref === undefined) {
      throw new CapabilityUnavailableError(this.capability());
    }
    const resolved = await this.options.secrets.resolve({
      organization_id: organizationId,
      secret_ref: this.options.secret_ref,
      purpose: 'openrouter-llm-request',
    });
    if (resolved.value.length === 0) throw new Error('OpenRouter SecretRef resolved to an empty credential');
    return resolved.value;
  }
}

export interface ModalExecutionContext {
  readonly account_id: string;
  readonly organization_id: OrganizationId;
  readonly workspace_id: WorkspaceId;
  readonly reservation_id: string;
  readonly request_id: string;
  readonly idempotency_key: string;
  readonly execution_target: Readonly<Record<string, unknown>>;
  readonly resources?: Readonly<Record<string, number | string>>;
  readonly input_artifacts?: readonly string[];
}

export interface ModalProviderExecution {
  readonly provider_job_id: string;
  readonly state: ComputeExecution['state'];
  readonly started_at?: string;
  readonly completed_at?: string;
  readonly heartbeat_at?: string;
  readonly timeout_at?: string;
  readonly failure_code?: string;
  readonly usage?: Readonly<Record<string, number>>;
}

export interface ModalExecutionTransport {
  submit(input: ModalExecutionContext): Promise<ModalProviderExecution>;
  inspect(providerJobId: string, input: { readonly request_id: string }): Promise<ModalProviderExecution | undefined>;
  cancel(providerJobId: string, input: { readonly request_id: string }): Promise<ModalProviderExecution>;
}

export interface ModalExecutionReferenceStore {
  get(executionId: string): Promise<ComputeExecution | undefined>;
}

export interface ModalExecutionAdapterOptions {
  readonly transport: ModalExecutionTransport;
  readonly resolve_context: (input: {
    readonly organization_id: OrganizationId;
    readonly workspace_id: WorkspaceId;
    readonly reservation_id: string;
    readonly request_id: string;
  }) => Promise<ModalExecutionContext>;
  readonly references: ModalExecutionReferenceStore;
  readonly next_execution_id: () => string;
}

/**
 * Modal execution target. The adapter only creates an internal execution after Modal returns
 * a provider job reference and a valid lifecycle state. The reference store is required so
 * status and cancellation survive Worker/adapter restarts.
 */
export class ModalExecutionAdapter implements ExecutionTarget {
  readonly adapter_name = 'modal-managed-execution';
  private readonly usageByExecution = new Map<string, HostedComputeUsage>();

  constructor(private readonly options: ModalExecutionAdapterOptions | undefined) {}

  capability(): CapabilityStatus {
    const configured = this.options !== undefined;
    return capabilityStatusSchema.parse({
      capability: 'hosted_compute',
      availability: configured ? 'available' : 'not_configured',
      adapter: this.adapter_name,
      reason: configured
        ? 'Modal transport, target resolver, and durable execution references are configured'
        : 'Modal transport and durable execution references are not configured',
      checked_at: nowIsoDateTime(),
    });
  }

  async submit(input: Parameters<HostedComputeAdapter['submit']>[0]): Promise<ComputeExecution> {
    const options = this.requireOptions();
    const context = await options.resolve_context({
      organization_id: input.organization_id,
      workspace_id: input.workspace_id,
      reservation_id: input.reservation_id,
      request_id: input.request_id,
    });
    if (context.reservation_id !== input.reservation_id || context.organization_id !== input.organization_id || context.workspace_id !== input.workspace_id) {
      throw new Error('Modal target resolver returned a context outside the requested tenant scope');
    }
    const provider = await options.transport.submit({ ...context, idempotency_key: input.request_id });
    return this.toExecution(context, provider, options.next_execution_id(), input.reservation_id);
  }

  async inspect(executionId: string): Promise<ComputeExecution | undefined> {
    const options = this.requireOptions();
    const current = await options.references.get(executionId);
    if (current === undefined) return undefined;
    if (current.worker_execution_ref === undefined) return undefined;
    const provider = await options.transport.inspect(current.worker_execution_ref, { request_id: `inspect:${executionId}` });
    if (provider === undefined) return undefined;
    const reportedUsage = actualSeconds(provider.usage);
    if (reportedUsage !== undefined) this.usageByExecution.set(executionId, reportedUsage);
    return computeExecutionSchema.parse({
      ...current,
      state: provider.state,
      worker_execution_ref: provider.provider_job_id,
      heartbeat_at: provider.heartbeat_at ?? current.heartbeat_at,
      started_at: provider.started_at ?? current.started_at,
      completed_at: provider.completed_at ?? current.completed_at,
      timeout_at: provider.timeout_at ?? current.timeout_at,
      failure_code: provider.failure_code ?? current.failure_code,
      metadata: provider.usage === undefined ? current.metadata : { ...current.metadata, modal_usage: provider.usage },
      version: current.version + 1,
      updated_at: nowIsoDateTime(),
      updated_by: { kind: 'system', id: 'modal-reconciler' },
    });
  }

  async usage(executionId: string): Promise<HostedComputeUsage | undefined> {
    const cached = this.usageByExecution.get(executionId);
    if (cached !== undefined) return cached;
    const options = this.requireOptions();
    const current = await options.references.get(executionId);
    if (current?.worker_execution_ref === undefined) return undefined;
    const provider = await options.transport.inspect(current.worker_execution_ref, { request_id: `usage:${executionId}` });
    const usage = actualSeconds(provider?.usage);
    if (usage === undefined) return undefined;
    this.usageByExecution.set(executionId, usage);
    return usage;
  }

  async cancel(input: Parameters<HostedComputeAdapter['cancel']>[0]): Promise<ComputeExecution> {
    const options = this.requireOptions();
    const current = await options.references.get(input.execution_id);
    if (current === undefined || current.worker_execution_ref === undefined) throw new Error('Modal execution reference not found');
    const provider = await options.transport.cancel(current.worker_execution_ref, { request_id: input.request_id });
    const usage = actualSeconds(provider.usage);
    if (usage !== undefined) this.usageByExecution.set(input.execution_id, usage);
    return computeExecutionSchema.parse({
      ...current,
      state: provider.state,
      worker_execution_ref: provider.provider_job_id,
      heartbeat_at: provider.heartbeat_at ?? current.heartbeat_at,
      completed_at: provider.completed_at ?? current.completed_at,
      failure_code: provider.failure_code ?? current.failure_code,
      metadata: provider.usage === undefined ? current.metadata : { ...current.metadata, modal_usage: provider.usage },
      version: current.version + 1,
      updated_at: nowIsoDateTime(),
      updated_by: { kind: 'system', id: 'modal-controller' },
    });
  }

  private toExecution(context: ModalExecutionContext, provider: ModalProviderExecution, executionId: string, reservationId: string): ComputeExecution {
    if (provider.provider_job_id.length === 0) throw new Error('Modal submit response did not include a provider job ID');
    if (!['queued', 'reserved', 'starting', 'running'].includes(provider.state)) {
      throw new Error(`Modal submit response returned non-starting state: ${provider.state}`);
    }
    const now = nowIsoDateTime();
    return computeExecutionSchema.parse({
      id: executionId,
      reservation_id: reservationId,
      account_id: context.account_id,
      organization_id: context.organization_id,
      workspace_id: context.workspace_id,
      state: provider.state,
      worker_execution_ref: provider.provider_job_id,
      heartbeat_at: provider.heartbeat_at ?? now,
      started_at: provider.started_at,
      timeout_at: provider.timeout_at,
      retry_count: 0,
      version: 1,
      created_at: now,
      updated_at: now,
      created_by: { kind: 'system', id: 'modal-dispatcher' },
      updated_by: { kind: 'system', id: 'modal-dispatcher' },
      metadata: provider.usage === undefined ? undefined : { modal_usage: provider.usage },
    });
  }

  private requireOptions(): ModalExecutionAdapterOptions {
    if (this.options === undefined) throw new CapabilityUnavailableError(this.capability());
    return this.options;
  }
}

export interface ModalWebFunctionTransportOptions {
  readonly submit_url: string;
  readonly inspect_url: string;
  readonly cancel_url: string;
  readonly token_id: string;
  readonly token_secret: string;
  readonly fetch?: typeof fetch;
}

/** HTTP transport for deployed Modal Web Functions protected by Modal proxy tokens. */
export class ModalWebFunctionTransport implements ModalExecutionTransport {
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: ModalWebFunctionTransportOptions) {
    this.fetcher = options.fetch ?? fetch;
    for (const url of [options.submit_url, options.inspect_url, options.cancel_url]) {
      if (!isHttpsUrl(url)) throw new Error('Modal Web Function endpoints must use HTTPS');
    }
    if (options.token_id.length === 0 || options.token_secret.length === 0) throw new Error('Modal proxy token is required');
  }

  async submit(input: ModalExecutionContext): Promise<ModalProviderExecution> {
    const result = await this.call(this.options.submit_url, input, input.idempotency_key);
    if (result === undefined) throw new Error('Modal submit endpoint returned no execution');
    return result;
  }

  async inspect(providerJobId: string, input: { readonly request_id: string }): Promise<ModalProviderExecution | undefined> {
    const response = await this.call(this.options.inspect_url, { provider_job_id: providerJobId }, input.request_id, true);
    return response;
  }

  async cancel(providerJobId: string, input: { readonly request_id: string }): Promise<ModalProviderExecution> {
    const result = await this.call(this.options.cancel_url, { provider_job_id: providerJobId }, input.request_id);
    if (result === undefined) throw new Error('Modal cancel endpoint returned no execution');
    return result;
  }

  private async call(url: string, body: unknown, idempotencyKey: string, allowNotFound = false): Promise<ModalProviderExecution | undefined> {
    const response = await this.fetcher(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'Modal-Key': this.options.token_id,
        'Modal-Secret': this.options.token_secret,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
    });
    if (allowNotFound && response.status === 404) return undefined;
    const text = await response.text();
    const record = parseJsonRecord(text, 'Modal Web Function response');
    if (!response.ok) {
      const error = asRecord(record['error']);
      throw new Error(`Modal provider request failed (${response.status}): ${safeMessage(error?.['message'] ?? text)}`);
    }
    return parseModalProviderExecution(record);
  }
}

function parseModalProviderExecution(value: Readonly<Record<string, unknown>>): ModalProviderExecution {
  const record = asRecord(value['execution']) ?? value;
  const providerJobId = record['provider_job_id'] ?? record['id'];
  const state = record['state'];
  if (typeof providerJobId !== 'string' || providerJobId.length === 0 || typeof state !== 'string') {
    throw new Error('Modal provider response must include provider_job_id and state');
  }
  if (!['queued', 'reserved', 'starting', 'running', 'completing', 'succeeded', 'failed', 'canceled', 'timed_out', 'reconciliation_required'].includes(state)) {
    throw new Error(`Modal provider response returned an unknown state: ${state}`);
  }
  return {
    provider_job_id: providerJobId,
    state: state as ComputeExecution['state'],
    started_at: optionalString(record['started_at']),
    completed_at: optionalString(record['completed_at']),
    heartbeat_at: optionalString(record['heartbeat_at']),
    timeout_at: optionalString(record['timeout_at']),
    failure_code: optionalString(record['failure_code']),
    usage: numericRecord(record['usage']),
  };
}

function chatCompletionsEndpoint(value: string): string {
  const endpoint = value.replace(/\/+$/u, '');
  return /\/chat\/completions$/u.test(endpoint) ? endpoint : `${endpoint}/chat/completions`;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function uniqueModels(model: string, fallbacks: readonly string[] | undefined): readonly string[] {
  return [...new Set([model, ...(fallbacks ?? [])].filter((candidate) => candidate.length > 0))];
}

function boundedAttempts(value: number | undefined): number {
  return Number.isInteger(value) && value !== undefined ? Math.min(Math.max(value, 1), 5) : DEFAULT_MAX_ATTEMPTS;
}

function boundedRetryDelay(value: number | undefined): number {
  return Number.isFinite(value) && value !== undefined ? Math.min(Math.max(value, 0), MAX_RETRY_DELAY_MS) : 250;
}

function requestMetadata(input: LLMRequest): Readonly<Record<string, string | number | boolean>> {
  const values: Record<string, string | number | boolean> = {
    spiderbyte_account_id: input.context.account_id,
    spiderbyte_organization_id: input.context.organization_id,
    spiderbyte_user_id: input.context.user_id ?? 'unknown',
    spiderbyte_workspace_id: input.context.workspace_id ?? 'unknown',
    spiderbyte_project_id: input.context.project_id ?? 'unknown',
    spiderbyte_run_id: input.context.run_id ?? 'unknown',
    spiderbyte_attempt_id: input.context.attempt_id ?? 'unknown',
    spiderbyte_plan: input.context.plan,
    spiderbyte_request_id: input.request_id,
    ...(input.metadata ?? {}),
  };
  // AI Gateway persists at most five custom metadata fields per request. The full context is
  // also carried in the trace object above, while this bounded header remains queryable.
  return Object.fromEntries(Object.entries(values).slice(0, 5));
}

function emptyUsage(): LLMUsage {
  return { input_tokens: 0, output_tokens: 0, cached_tokens: 0, total_tokens: 0 };
}

function parseUsage(value: unknown, previous: LLMUsage): LLMUsage {
  const record = asRecord(value);
  if (record === undefined) return previous;
  const promptTokens = nonnegativeNumber(record['prompt_tokens']) ?? previous.input_tokens;
  const completionTokens = nonnegativeNumber(record['completion_tokens']) ?? previous.output_tokens;
  const cachedTokens = nonnegativeNumber(asRecord(record['prompt_tokens_details'])?.['cached_tokens'])
    ?? nonnegativeNumber(record['cached_tokens'])
    ?? previous.cached_tokens;
  const totalTokens = nonnegativeNumber(record['total_tokens']) ?? promptTokens + completionTokens;
  const costValue = nonnegativeNumber(record['cost']);
  return {
    input_tokens: promptTokens,
    output_tokens: completionTokens,
    cached_tokens: cachedTokens,
    total_tokens: totalTokens,
    provider_cost: costValue === undefined ? previous.provider_cost : { currency: 'USD', amount: costValue },
  };
}

function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    if (typeof part === 'string') return part;
    const record = asRecord(part);
    return typeof record?.['text'] === 'string' ? record['text'] : typeof record?.['content'] === 'string' ? record['content'] : '';
  }).join('');
}

function firstRecord(value: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(value)) return undefined;
  return asRecord(value[0]);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function parseJsonRecord(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} was not valid JSON`);
  }
  const record = asRecord(parsed);
  if (record === undefined) throw new Error(`${label} must be a JSON object`);
  return record;
}

async function providerErrorFromResponse(response: Response): Promise<OpenRouterProviderError> {
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    parsed = undefined;
  }
  const record = asRecord(parsed);
  const errorValue = record?.['error'];
  return providerErrorFromBody(errorValue ?? record ?? text, response.status, response.headers.get('retry-after'));
}

function providerErrorFromBody(value: unknown, status: number, retryAfter?: string | null): OpenRouterProviderError {
  const record = asRecord(value);
  const codeValue = record?.['code'];
  const messageValue = record?.['message'];
  const providerStatus = typeof codeValue === 'number' && Number.isInteger(codeValue) ? codeValue : status;
  const code = typeof codeValue === 'number' || typeof codeValue === 'string' ? String(codeValue) : `http_${status}`;
  const message = safeMessage(typeof messageValue === 'string' ? messageValue : value);
  const retryable = providerStatus === 408 || providerStatus === 429 || providerStatus === 500 || providerStatus === 502 || providerStatus === 503 || providerStatus === 504;
  const error = new OpenRouterProviderError(`openrouter.${code}`, message, providerStatus, retryable);
  if (retryAfter !== undefined && retryAfter !== null) {
    const retryMs = Number(retryAfter) * 1000;
    if (Number.isFinite(retryMs)) Object.defineProperty(error, 'retry_after_ms', { value: retryMs });
  }
  return error;
}

function retryDelay(error: OpenRouterProviderError, attempt: number, base: number): number {
  const retryAfter = (error as OpenRouterProviderError & { readonly retry_after_ms?: number }).retry_after_ms;
  if (retryAfter !== undefined) return Math.min(Math.max(retryAfter, 0), 60_000);
  return Math.min(base * 2 ** Math.max(attempt - 1, 0), MAX_RETRY_DELAY_MS);
}

function providerErrorEvent(error: unknown): LLMStreamEvent {
  return {
    type: 'error',
    error: {
      code: error instanceof OpenRouterProviderError ? error.code : 'openrouter.request_failed',
      message: safeMessage(error instanceof Error ? error.message : error),
    },
  };
}

function safeMessage(value: unknown): string {
  const message = typeof value === 'string' ? value : 'provider request failed';
  return message.replaceAll(/(?:Bearer\s+)[^\s]+/giu, 'Bearer [redacted]').slice(0, 500);
}

function nonnegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function numericRecord(value: unknown): Readonly<Record<string, number>> | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const result: Record<string, number> = {};
  for (const [key, item] of Object.entries(record)) {
    const number = nonnegativeNumber(item);
    if (number !== undefined) result[key] = number;
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

function actualSeconds(usage: Readonly<Record<string, number>> | undefined): HostedComputeUsage | undefined {
  const actual = usage?.['actual_seconds'];
  return actual === undefined || !Number.isFinite(actual) || actual < 0
    ? undefined
    : { actual_amount: actual, unit: 'seconds' };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function requestSignal(input: AbortSignal | undefined, timeoutMs: number | undefined): {
  readonly signal: AbortSignal;
  readonly cleanup: () => void;
} {
  const controller = new AbortController();
  const abort = (): void => controller.abort(input?.reason);
  if (input !== undefined) {
    if (input.aborted) abort();
    else input.addEventListener('abort', abort, { once: true });
  }
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      if (input !== undefined) input.removeEventListener('abort', abort);
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

async function wait(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function* sseData(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line === '') {
          if (dataLines.length > 0) {
            yield dataLines.join('\n');
            dataLines = [];
          }
          continue;
        }
        if (line.startsWith(':')) continue;
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
      if (chunk.done) break;
    }
    if (buffer.startsWith('data:')) dataLines.push(buffer.slice(5).trimStart());
    if (dataLines.length > 0) yield dataLines.join('\n');
  } finally {
    reader.releaseLock();
  }
}
