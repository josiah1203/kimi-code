/**
 * Browser-safe platform client.
 *
 * This is intentionally a small HTTP/WS projection over the canonical Kimi
 * routes. It does not contain persistence, provider, Run, or transcript
 * authority. The browser keeps only opaque ids and projections; secrets are
 * accepted by the setup request and are never echoed into client state.
 */

import {
  analysisCreateInputSchema,
  analysisSchema,
  artifactDownloadChunkSchema,
  artifactDownloadSchema,
  artifactLineageSchema,
  artifactSchema,
  datasetCreateInputSchema,
  datasetProfileInputSchema,
  datasetProfileSchema,
  datasetQueryInputSchema,
  datasetQueryResultSchema,
  datasetSchema,
  envelopeSchema,
  evaluationCreateInputSchema,
  evaluationSchema,
  experimentCompareInputSchema,
  experimentComparisonSchema,
  experimentCreateInputSchema,
  experimentSchema,
  modelRegisterInputSchema,
  modelStageInputSchema,
  modelVersionSchema,
  platformLifecycleEventSchema,
  platformReplayPageSchema,
  providerConnectionCommandInputSchema,
  providerConnectionCreateInputSchema,
  providerConnectionCreateWithSecretInputSchema,
  providerConnectionSchema,
  providerModelDiscoverySchema,
  runSchema,
  trainingStartInputSchema,
  trainingRunSchema,
  type Analysis,
  type AnalysisCreateInput,
  type Artifact,
  type ArtifactDownload,
  type ArtifactDownloadChunk,
  type ArtifactDownloadRangeInput,
  type ArtifactLineage,
  type Dataset,
  type DatasetCreateInput,
  type DatasetProfile,
  type DatasetProfileInput,
  type DatasetQueryInput,
  type DatasetQueryResult,
  type Evaluation,
  type EvaluationCreateInput,
  type Experiment,
  type ExperimentComparison,
  type ExperimentCompareInput,
  type ExperimentCreateInput,
  type ModelRegisterInput,
  type ModelStageInput,
  type ModelVersion,
  type PlatformLifecycleEvent,
  type PlatformReplayPage,
  type ProviderConnection,
  type ProviderConnectionCommandInput,
  type ProviderConnectionCreateInput,
  type ProviderConnectionCreateWithSecretInput,
  type ProviderModelDiscovery,
  type Run,
  type TrainingRun,
  type TrainingStartInput,
} from '@moonshot-ai/protocol';
import { z } from 'zod';

export interface BrowserFetchInit {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface BrowserFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export type BrowserFetch = (url: string, init?: BrowserFetchInit) => Promise<BrowserFetchResponse>;

export interface BrowserWebSocketLike {
  readonly OPEN: number;
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { readonly data: string }) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export type BrowserWebSocketFactory = (url: string, protocols?: string | readonly string[]) => BrowserWebSocketLike;

export interface BrowserPlatformClientOptions {
  /** Origin or API prefix, for example `https://kimi.example.test`. */
  readonly baseUrl: string;
  /** A bearer token kept in memory by the embedding application. */
  readonly token?: string | (() => string | undefined | Promise<string | undefined>);
  readonly fetch?: BrowserFetch;
  readonly webSocket?: BrowserWebSocketFactory;
  readonly reconnectDelayMs?: number;
}

export class BrowserPlatformError extends Error {
  readonly code: number;
  readonly requestId: string | undefined;
  readonly details: unknown;

  constructor(code: number, message: string, requestId?: string, details?: unknown) {
    super(message);
    this.name = 'BrowserPlatformError';
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

export interface BrowserPlatformWorkspace {
  listConnections(): Promise<readonly ProviderConnection[]>;
  createConnection(input: ProviderConnectionCreateInput | ProviderConnectionCreateWithSecretInput): Promise<ProviderConnection>;
  validateConnection(id: string, input?: ProviderConnectionCommandInput): Promise<ProviderConnection | undefined>;
  discoverModels(id: string): Promise<ProviderModelDiscovery | undefined>;
  listDatasets(): Promise<readonly Dataset[]>;
  getDataset(id: string): Promise<Dataset | undefined>;
  createDataset(input: DatasetCreateInput): Promise<Dataset>;
  profileDataset(id: string, input: DatasetProfileInput): Promise<DatasetProfile | undefined>;
  queryDataset(id: string, input: DatasetQueryInput): Promise<DatasetQueryResult | undefined>;
  listAnalyses(): Promise<readonly Analysis[]>;
  analyze(input: AnalysisCreateInput): Promise<Analysis | undefined>;
  listExperiments(): Promise<readonly Experiment[]>;
  createExperiment(input: ExperimentCreateInput): Promise<Experiment>;
  train(experimentId: string, input: TrainingStartInput): Promise<TrainingRun | undefined>;
  listTrainingRuns(experimentId?: string): Promise<readonly TrainingRun[]>;
  listEvaluations(experimentId?: string): Promise<readonly Evaluation[]>;
  evaluate(input: EvaluationCreateInput): Promise<Evaluation | undefined>;
  compare(input: ExperimentCompareInput): Promise<ExperimentComparison | undefined>;
  listModels(experimentId?: string): Promise<readonly ModelVersion[]>;
  registerModel(input: ModelRegisterInput): Promise<ModelVersion | undefined>;
  stageModel(id: string, input: ModelStageInput): Promise<ModelVersion | undefined>;
  listArtifacts(): Promise<readonly Artifact[]>;
  getArtifact(id: string): Promise<Artifact | undefined>;
  downloadArtifact(id: string): Promise<ArtifactDownload | undefined>;
  downloadArtifactRange(id: string, input?: ArtifactDownloadRangeInput): Promise<ArtifactDownloadChunk | undefined>;
  artifactLineage(id: string): Promise<ArtifactLineage | undefined>;
  replay(afterSequence?: number, limit?: number): Promise<PlatformReplayPage>;
  subscribeEvents(handlers: BrowserPlatformEventHandlers, options?: BrowserPlatformEventOptions): BrowserPlatformEventSubscription;
  listRuns(sessionId: string): Promise<readonly Run[]>;
  getRun(sessionId: string, runId: string): Promise<Run | undefined>;
  getTranscript(sessionId: string, agentId?: string, options?: BrowserTranscriptPageOptions): Promise<BrowserTranscriptPage | undefined>;
  getTranscriptOps(sessionId: string, agentId: string, sinceSequence: number): Promise<BrowserTranscriptOps | undefined>;
}

/** Transcript projections are deliberately opaque to the platform client. The
 * transcript package remains the rendering authority; this client only
 * transports the versioned REST projection and replay cursor. */
export interface BrowserTranscriptPage {
  readonly agent_id: string;
  readonly items: readonly unknown[];
  readonly has_more: boolean;
  readonly seq?: number;
  readonly [key: string]: unknown;
}

export interface BrowserTranscriptOps {
  readonly agent_id: string;
  readonly batches: readonly unknown[];
  readonly latest_seq: number;
  readonly complete: boolean;
  readonly [key: string]: unknown;
}

export interface BrowserTranscriptPageOptions {
  readonly beforeTurn?: string;
  readonly afterTurn?: string;
  readonly pageSize?: number;
}

export interface BrowserPlatformEventHandlers {
  readonly onEvent: (event: PlatformLifecycleEvent) => void;
  readonly onError?: (error: Error) => void;
  /** Called when the stream detects a cursor gap that replay could not fill. */
  readonly onGap?: (fromSequence: number, toSequence: number) => void;
}

export interface BrowserPlatformEventOptions {
  readonly afterSequence?: number;
  readonly limit?: number;
  readonly eventTypes?: readonly string[];
  readonly entityTypes?: readonly string[];
  readonly reconnect?: boolean;
}

export interface BrowserPlatformEventSubscription {
  readonly cursor: number;
  dispose(): void;
}

type Schema = z.ZodTypeAny;

const browserTranscriptPageSchema = z.object({
  agent_id: z.string().min(1),
  items: z.array(z.unknown()),
  has_more: z.boolean(),
  seq: z.number().int().nonnegative().optional(),
}).passthrough();

const browserTranscriptOpsSchema = z.object({
  agent_id: z.string().min(1),
  batches: z.array(z.unknown()),
  latest_seq: z.number().int().nonnegative(),
  complete: z.boolean(),
}).passthrough();

export class BrowserPlatformClient {
  private readonly baseUrl: string;
  private readonly token: BrowserPlatformClientOptions['token'];
  private readonly fetchImpl: BrowserFetch;
  private readonly webSocket: BrowserWebSocketFactory | undefined;
  private readonly reconnectDelayMs: number;

  constructor(options: BrowserPlatformClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.fetchImpl = options.fetch ?? defaultFetch();
    this.webSocket = options.webSocket;
    this.reconnectDelayMs = Math.max(100, options.reconnectDelayMs ?? 1_000);
  }

  workspace(workspaceId: string): BrowserPlatformWorkspace {
    const workspaceKey = requireId(workspaceId, 'workspaceId');
    const id = encodeURIComponent(workspaceKey);
    const request = <T>(path: string, method: string, body: unknown, schema: Schema): Promise<T | undefined> =>
      this.request<T>(`/api/v2/workspaces/${id}${path}`, method, body, schema);
    const runRequest = <T>(sessionId: string, path: string, method: string, body: unknown, schema: Schema): Promise<T | undefined> =>
      this.request<T>(`/api/v2/sessions/${encodeURIComponent(requireId(sessionId, 'sessionId'))}${path}`, method, body, schema);
    return {
      listConnections: () => request<readonly ProviderConnection[]>('/platform/connections', 'GET', undefined, z.array(providerConnectionSchema)) as Promise<readonly ProviderConnection[]>,
      createConnection: (input) => {
        const parsed = 'secret' in input
          ? providerConnectionCreateWithSecretInputSchema.parse(input)
          : providerConnectionCreateInputSchema.parse(input);
        return request<ProviderConnection>('/platform/connections', 'POST', parsed, providerConnectionSchema) as Promise<ProviderConnection>;
      },
      validateConnection: (connectionId, input) => request<ProviderConnection>(`/platform/connections/${encodeURIComponent(requireId(connectionId, 'connectionId'))}/validate`, 'POST', providerConnectionCommandInputSchema.parse(input ?? { request_id: makeRequestId('validate') }), providerConnectionSchema),
      discoverModels: (connectionId) => request<ProviderModelDiscovery>(`/platform/connections/${encodeURIComponent(requireId(connectionId, 'connectionId'))}/models`, 'GET', undefined, providerModelDiscoverySchema),
      listDatasets: () => request<readonly Dataset[]>('/platform/datasets', 'GET', undefined, z.array(datasetSchema)) as Promise<readonly Dataset[]>,
      getDataset: (datasetId) => request<Dataset>(`/platform/datasets/${encodeURIComponent(requireId(datasetId, 'datasetId'))}`, 'GET', undefined, datasetSchema),
      createDataset: (input) => request<Dataset>('/platform/datasets', 'POST', datasetCreateInputSchema.parse(input), datasetSchema) as Promise<Dataset>,
      profileDataset: (datasetId, input) => request<DatasetProfile>(`/platform/datasets/${encodeURIComponent(requireId(datasetId, 'datasetId'))}/profile`, 'POST', datasetProfileInputSchema.parse(input), datasetProfileSchema),
      queryDataset: (datasetId, input) => request<DatasetQueryResult>(`/platform/datasets/${encodeURIComponent(requireId(datasetId, 'datasetId'))}/query`, 'POST', datasetQueryInputSchema.parse(input), datasetQueryResultSchema),
      listAnalyses: () => request<readonly Analysis[]>('/platform/ml/analyses', 'GET', undefined, z.array(analysisSchema)) as Promise<readonly Analysis[]>,
      analyze: (input) => request<Analysis>('/platform/ml/analyses', 'POST', analysisCreateInputSchema.parse(input), analysisSchema),
      listExperiments: () => request<readonly Experiment[]>('/platform/ml/experiments', 'GET', undefined, z.array(experimentSchema)) as Promise<readonly Experiment[]>,
      createExperiment: (input) => request<Experiment>('/platform/ml/experiments', 'POST', experimentCreateInputSchema.parse(input), experimentSchema) as Promise<Experiment>,
      train: (experimentId, input) => request<TrainingRun>(`/platform/ml/experiments/${encodeURIComponent(requireId(experimentId, 'experimentId'))}/train`, 'POST', trainingStartInputSchema.parse(input), trainingRunSchema),
      listTrainingRuns: (experimentId) => request<readonly TrainingRun[]>(`/platform/ml/training-runs${query({ experiment_id: experimentId })}`, 'GET', undefined, z.array(trainingRunSchema)) as Promise<readonly TrainingRun[]>,
      listEvaluations: (experimentId) => request<readonly Evaluation[]>(`/platform/ml/evaluations${query({ experiment_id: experimentId })}`, 'GET', undefined, z.array(evaluationSchema)) as Promise<readonly Evaluation[]>,
      evaluate: (input) => request<Evaluation>('/platform/ml/evaluations', 'POST', evaluationCreateInputSchema.parse(input), evaluationSchema),
      compare: (input) => request<ExperimentComparison>('/platform/ml/comparisons', 'POST', experimentCompareInputSchema.parse(input), experimentComparisonSchema),
      listModels: (experimentId) => request<readonly ModelVersion[]>(`/platform/ml/models${query({ experiment_id: experimentId })}`, 'GET', undefined, z.array(modelVersionSchema)) as Promise<readonly ModelVersion[]>,
      registerModel: (input) => request<ModelVersion>('/platform/ml/models', 'POST', modelRegisterInputSchema.parse(input), modelVersionSchema),
      stageModel: (modelId, input) => request<ModelVersion>(`/platform/ml/models/${encodeURIComponent(requireId(modelId, 'modelId'))}/stage`, 'POST', modelStageInputSchema.parse(input), modelVersionSchema),
      listArtifacts: () => request<readonly Artifact[]>('/platform/artifacts', 'GET', undefined, z.array(artifactSchema)) as Promise<readonly Artifact[]>,
      getArtifact: (artifactId) => request<Artifact>(`/platform/artifacts/${encodeURIComponent(requireId(artifactId, 'artifactId'))}`, 'GET', undefined, artifactSchema),
      downloadArtifact: (artifactId) => request<ArtifactDownload>(`/platform/artifacts/${encodeURIComponent(requireId(artifactId, 'artifactId'))}/download`, 'GET', undefined, artifactDownloadSchema),
      downloadArtifactRange: (artifactId, input) => request<ArtifactDownloadChunk>(`/platform/artifacts/${encodeURIComponent(requireId(artifactId, 'artifactId'))}/download/range${query(input ?? {})}`, 'GET', undefined, artifactDownloadChunkSchema),
      artifactLineage: (artifactId) => request<ArtifactLineage>(`/platform/artifacts/${encodeURIComponent(requireId(artifactId, 'artifactId'))}/lineage`, 'GET', undefined, artifactLineageSchema),
      replay: (afterSequence, limit) => request<PlatformReplayPage>(`/platform/events${query({ after_sequence: afterSequence, limit })}`, 'GET', undefined, platformReplayPageSchema) as Promise<PlatformReplayPage>,
      subscribeEvents: (handlers, options) => new PlatformEventStream(this, workspaceKey, handlers, options, this.webSocket, this.reconnectDelayMs),
      listRuns: (sessionId) => runRequest<readonly Run[]>(sessionId, '/runs', 'GET', undefined, z.array(runSchema)) as Promise<readonly Run[]>,
      getRun: (sessionId, runId) => runRequest<Run>(sessionId, `/runs/${encodeURIComponent(requireId(runId, 'runId'))}`, 'GET', undefined, runSchema),
      getTranscript: (sessionId, agentId = 'main', options) => this.request<BrowserTranscriptPage>(
        `/api/v1/sessions/${encodeURIComponent(requireId(sessionId, 'sessionId'))}/transcript${query({
          agent_id: requireId(agentId, 'agentId'),
          before_turn: options?.beforeTurn,
          after_turn: options?.afterTurn,
          page_size: options?.pageSize,
        })}`,
        'GET',
        undefined,
        browserTranscriptPageSchema,
      ),
      getTranscriptOps: (sessionId, agentId, sinceSequence) => this.request<BrowserTranscriptOps>(
        `/api/v1/sessions/${encodeURIComponent(requireId(sessionId, 'sessionId'))}/transcript/ops${query({
          agent_id: requireId(agentId, 'agentId'),
          since_seq: requireSequence(sinceSequence),
        })}`,
        'GET',
        undefined,
        browserTranscriptOpsSchema,
      ),
    };
  }

  async request<T>(path: string, method: string, body: unknown, schema: Schema): Promise<T | undefined> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const token = typeof this.token === 'function' ? await this.token() : this.token;
    if (token !== undefined && token.length > 0) headers['authorization'] = `Bearer ${token}`;
    let response: BrowserFetchResponse;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new BrowserPlatformError(-1, error instanceof Error ? error.message : 'platform request failed');
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await response.text());
    } catch {
      throw new BrowserPlatformError(response.status, 'platform returned invalid JSON');
    }
    const envelope = envelopeSchema(z.unknown()).safeParse(raw);
    if (!envelope.success) throw new BrowserPlatformError(response.status, 'platform returned an invalid response envelope');
    if (envelope.data.code !== 0) {
      throw new BrowserPlatformError(envelope.data.code, envelope.data.msg, envelope.data.request_id, envelope.data.details);
    }
    if (!response.ok) throw new BrowserPlatformError(response.status, 'platform request failed', envelope.data.request_id);
    if (envelope.data.data === null) return undefined;
    return schema.parse(envelope.data.data) as T;
  }

  /** The WS endpoint is derived from the same origin as the REST client. */
  webSocketUrl(): string {
    return this.baseUrl.replace(/^http/, 'ws') + '/api/v2/platform/ws';
  }

  async webSocketProtocols(): Promise<readonly string[] | undefined> {
    const token = typeof this.token === 'function' ? await this.token() : this.token;
    if (token === undefined || token.length === 0) return undefined;
    if (/[,\s]/.test(token)) throw new BrowserPlatformError(-1, 'websocket bearer token contains invalid protocol characters');
    return [`kimi-code.bearer.${token}`];
  }
}

class PlatformEventStream implements BrowserPlatformEventSubscription {
  private readonly reconnect: boolean;
  private readonly limit: number;
  private readonly options: BrowserPlatformEventOptions;
  private socket: BrowserWebSocketLike | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private recovering = Promise.resolve();
  private cursorValue: number;
  private requestSequence = 0;

  constructor(
    private readonly client: BrowserPlatformClient,
    private readonly workspaceId: string,
    private readonly handlers: BrowserPlatformEventHandlers,
    options: BrowserPlatformEventOptions | undefined,
    factory: BrowserWebSocketFactory | undefined,
    private readonly reconnectDelayMs: number,
  ) {
    if (factory === undefined) {
      throw new BrowserPlatformError(-1, 'platform websocket support is unavailable in this browser client');
    }
    this.factory = factory;
    this.options = options ?? {};
    this.reconnect = this.options.reconnect ?? true;
    this.limit = this.options.limit ?? 100;
    this.cursorValue = this.options.afterSequence ?? 0;
    this.connect();
  }

  private readonly factory: BrowserWebSocketFactory;

  get cursor(): number {
    return this.cursorValue;
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.socket?.close();
    this.socket = undefined;
  }

  private connect(): void {
    if (this.disposed) return;
    void this.connectAsync();
  }

  private async connectAsync(): Promise<void> {
    if (this.disposed) return;
    try {
      const socket = this.factory(this.client.webSocketUrl(), await this.client.webSocketProtocols());
      this.socket = socket;
      socket.onopen = () => {
        this.send({
          type: 'subscribe',
          request_id: this.nextRequestId(),
          workspace_id: this.workspaceId,
          after_sequence: this.cursorValue,
          limit: this.limit,
          ...(this.options.eventTypes === undefined ? {} : { event_types: [...this.options.eventTypes] }),
          ...(this.options.entityTypes === undefined ? {} : { entity_types: [...this.options.entityTypes] }),
        });
      };
      socket.onmessage = (message) => { this.handleMessage(message.data); };
      socket.onerror = () => this.handlers.onError?.(new Error('platform websocket error'));
      socket.onclose = () => {
        this.socket = undefined;
        if (!this.disposed && this.reconnect) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            this.connect();
          }, this.reconnectDelayMs);
        }
      };
    } catch (error) {
      this.handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
      if (!this.disposed && this.reconnect) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = undefined;
          this.connect();
        }, this.reconnectDelayMs);
      }
    }
  }

  private handleMessage(raw: string): void {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      this.handlers.onError?.(new Error('platform websocket returned invalid JSON'));
      return;
    }
    if (!isRecord(message)) return;
    if (message['type'] === 'ack' && typeof message['code'] === 'number' && message['code'] !== 0) {
      this.handlers.onError?.(new BrowserPlatformError(message['code'], typeof message['msg'] === 'string' ? message['msg'] : 'platform websocket request failed'));
      return;
    }
    if (message['type'] !== 'platform_event') return;
    const parsed = platformLifecycleEventSchema.safeParse(message['event']);
    if (!parsed.success) {
      this.handlers.onError?.(new Error(`invalid platform event: ${parsed.error.message}`));
      return;
    }
    const event = parsed.data;
    this.recovering = this.recovering.then(async () => {
      if (event.sequence <= this.cursorValue) return;
      if (event.sequence > this.cursorValue + 1) {
        const from = this.cursorValue + 1;
        await this.recoverGap(event.sequence - 1);
        if (event.sequence > this.cursorValue + 1) this.handlers.onGap?.(from, event.sequence - 1);
      }
      if (event.sequence <= this.cursorValue) return;
      this.cursorValue = event.sequence;
      this.handlers.onEvent(event);
    }).catch((error: unknown) => {
      this.handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
    });
  }

  private async recoverGap(targetSequence: number): Promise<void> {
    while (this.cursorValue < targetSequence) {
      const page = await this.client.workspace(this.workspaceId).replay(this.cursorValue, this.limit);
      let advanced = false;
      for (const event of page.events) {
        if (event.sequence <= this.cursorValue || event.sequence > targetSequence) continue;
        this.cursorValue = event.sequence;
        advanced = true;
        this.handlers.onEvent(event);
      }
      if (!advanced || !page.has_more) return;
    }
  }

  private send(message: unknown): void {
    const socket = this.socket;
    if (socket !== undefined && socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `browser-platform-${Date.now().toString(36)}-${this.requestSequence.toString(36)}`;
  }
}

function query(values: Readonly<Record<string, number | string | undefined>>): string {
  const entries = Object.entries(values).filter((entry): entry is [string, string | number] =>
    entry[1] !== undefined && String(entry[1]).length > 0,
  );
  if (entries.length === 0) return '';
  return `?${entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&')}`;
}

function requireId(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${name} must not be empty`);
  return normalized;
}

function requireSequence(value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new TypeError('sinceSequence must be a non-negative integer');
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function defaultFetch(): BrowserFetch {
  const candidate = (globalThis as unknown as { readonly fetch?: BrowserFetch }).fetch;
  if (candidate === undefined) throw new BrowserPlatformError(-1, 'fetch is unavailable in this environment');
  return candidate;
}

let requestCounter = 0;

function makeRequestId(operation: string): string {
  requestCounter += 1;
  return `browser-platform:${operation}:${Date.now().toString(36)}:${requestCounter.toString(36)}`;
}
