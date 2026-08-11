/**
 * Deployable customer-managed worker boundary.
 *
 * The worker is intentionally an HTTP boundary, not another platform
 * authority.  It authenticates requests, advertises capabilities, dedupes
 * request ids, supports cancellation, and returns content-addressed output
 * bytes for the workspace execution service to import.  The built-in ML
 * executor is bounded and deterministic; teams can supply an executor for
 * their own runtimes without changing the wire contract.
 */

import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { z } from 'zod';

import { artifactKindSchema, platformMetadataSchema, type ArtifactKind } from '@spiderbyte/protocol';

const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;

const inputArtifactSchema = z.strictObject({
  artifact_id: z.string().min(1),
  name: z.string().min(1).max(500),
  kind: z.string().min(1),
  media_type: z.string().min(1).optional(),
  content_base64: z.string().max(Math.ceil((MAX_ARTIFACT_BYTES * 4) / 3) + 4),
});

const requestSchema = z.strictObject({
  protocol_version: z.literal(1),
  workspace_id: z.string().min(1),
  run_id: z.string().min(1),
  request_id: z.string().min(1),
  target_id: z.string().min(1),
  lease_id: z.string().min(1).optional(),
  operation: z.enum(['analysis', 'training', 'evaluation', 'comparison', 'serving']),
  payload: z.record(z.string(), z.unknown()),
  policy_decision_id: z.string().min(1).optional(),
});

const outputArtifactSchema = z.strictObject({
  name: z.string().min(1).max(500),
  kind: artifactKindSchema,
  content_base64: z.string().max(Math.ceil((MAX_ARTIFACT_BYTES * 4) / 3) + 4),
  media_type: z.string().min(1).optional(),
  source_artifact_ids: z.array(z.string().min(1)).max(100).optional(),
  metadata: platformMetadataSchema.optional(),
});

const responseSchema = z.strictObject({
  status: z.enum(['succeeded', 'failed']),
  output_artifacts: z.array(outputArtifactSchema).max(100).default([]),
  metrics: z.record(z.string(), z.number().finite()).optional(),
  metadata: platformMetadataSchema.optional(),
  error: z.string().max(2_000).optional(),
});

export type PlatformWorkerRequest = z.infer<typeof requestSchema>;
export type PlatformWorkerArtifact = z.infer<typeof outputArtifactSchema>;
export type PlatformWorkerResponse = z.infer<typeof responseSchema>;
export type PlatformWorkerOperation = PlatformWorkerRequest['operation'];
export type PlatformWorkerSignal = globalThis.AbortSignal;

export interface PlatformWorkerExecutor {
  execute(request: PlatformWorkerRequest, signal: PlatformWorkerSignal): Promise<PlatformWorkerResponse>;
}

export interface PlatformWorkerOptions {
  readonly workerId: string;
  readonly capabilities: readonly string[];
  /** A bearer token or a callback for rotating customer-managed credentials. */
  readonly token: string | (() => string | undefined | Promise<string | undefined>);
  readonly executor: PlatformWorkerExecutor;
}

export interface PlatformWorkerServer {
  readonly server: Server;
  readonly address: string | null;
}

export interface PlatformWorkerExecutionState {
  readonly completed: Map<string, { readonly fingerprint: string; readonly response: PlatformWorkerResponse }>;
}

export function createPlatformWorkerState(): PlatformWorkerExecutionState {
  return { completed: new Map() };
}

/** Execute one already-authenticated request; useful for embedded runtimes and tests. */
export async function executePlatformWorkerRequest(
  options: PlatformWorkerOptions,
  request: PlatformWorkerRequest,
  state: PlatformWorkerExecutionState = createPlatformWorkerState(),
  signal: PlatformWorkerSignal = new AbortController().signal,
): Promise<PlatformWorkerResponse> {
  if (!hasCapability(options.capabilities, request.operation)) {
    return {
      status: 'failed',
      output_artifacts: [],
      error: `worker does not advertise '${request.operation}' capability`,
    };
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const previous = state.completed.get(request.request_id);
  if (previous !== undefined) {
    if (previous.fingerprint !== fingerprint) {
      return { status: 'failed', output_artifacts: [], error: 'request id was reused with different input' };
    }
    return previous.response;
  }
  try {
    const result = responseSchema.parse(await options.executor.execute(request, signal));
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_RESPONSE_BYTES) {
      return { status: 'failed', output_artifacts: [], error: 'worker response is too large' };
    }
    state.completed.set(request.request_id, { fingerprint, response: result });
    return result;
  } catch (error) {
    return {
      status: 'failed',
      output_artifacts: [],
      error: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
    };
  }
}

/** Create a worker that can be started by a customer-managed process. */
export function createPlatformWorkerServer(options: PlatformWorkerOptions): PlatformWorkerServer {
  if (options.workerId.trim().length === 0) throw new TypeError('workerId must not be empty');
  if (options.capabilities.length === 0) throw new TypeError('worker capabilities must not be empty');
  const state = createPlatformWorkerState();
  const active = new Map<string, AbortController>();
  const server = createServer((request, response) => {
    void handleRequest(request, response, options, state, active);
  });
  return {
    server,
    get address(): string | null {
      const value = server.address();
      if (value === null || typeof value === 'string') return value;
      return `http://${value.address}:${value.port}`;
    },
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: PlatformWorkerOptions,
  state: PlatformWorkerExecutionState,
  active: Map<string, AbortController>,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://worker.invalid');
  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, {
      status: 'ready',
      worker_id: options.workerId,
      protocol_version: 1,
      capabilities: [...options.capabilities],
    });
    return;
  }
  if (request.method === 'DELETE' && url.pathname.startsWith('/v1/execute/')) {
    if (!(await isAuthorized(request, options.token))) return sendError(response, 401, 'worker authorization failed');
    const requestId = decodeURIComponent(url.pathname.slice('/v1/execute/'.length));
    const controller = active.get(requestId);
    if (controller === undefined) return sendJson(response, 200, { cancelled: false });
    controller.abort();
    return sendJson(response, 200, { cancelled: true });
  }
  if (request.method === 'GET' && url.pathname === '/v1/capabilities') {
    if (!(await isAuthorized(request, options.token))) return sendError(response, 401, 'worker authorization failed');
    sendJson(response, 200, { worker_id: options.workerId, protocol_version: 1, capabilities: [...options.capabilities] });
    return;
  }
  if (request.method !== 'POST' || url.pathname !== '/v1/execute') {
    sendError(response, 404, 'worker route not found');
    return;
  }
  if (!(await isAuthorized(request, options.token))) return sendError(response, 401, 'worker authorization failed');
  const body = await readBody(request);
  if (body === undefined) return sendError(response, 413, 'worker request is too large or invalid');
  let parsed: PlatformWorkerRequest;
  try {
    parsed = requestSchema.parse(JSON.parse(body));
  } catch {
    sendError(response, 400, 'worker request does not match the execution contract');
    return;
  }
  if (!hasCapability(options.capabilities, parsed.operation)) {
    sendJson(response, 409, { status: 'failed', output_artifacts: [], error: `worker does not advertise '${parsed.operation}' capability` });
    return;
  }
  const controller = new AbortController();
  active.set(parsed.request_id, controller);
  try {
    const result = await executePlatformWorkerRequest(options, parsed, state, controller.signal);
    sendJson(response, 200, result);
  } finally {
    active.delete(parsed.request_id);
  }
}

async function isAuthorized(
  request: IncomingMessage,
  token: PlatformWorkerOptions['token'],
): Promise<boolean> {
  const value = typeof token === 'function' ? await token() : token;
  if (value === undefined || value.length === 0) return false;
  return request.headers.authorization === `Bearer ${value}`;
}

async function readBody(request: IncomingMessage): Promise<string | undefined> {
  const declared = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) return undefined;
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.byteLength;
    if (length > MAX_REQUEST_BYTES) return undefined;
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function hasCapability(capabilities: readonly string[], operation: PlatformWorkerOperation): boolean {
  return capabilities.includes(operation) || capabilities.includes('ml') || capabilities.includes('pipeline');
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(value));
}

function sendError(response: ServerResponse, status: number, message: string): void {
  sendJson(response, status, { status: 'failed', output_artifacts: [], error: message });
}

/** Explicit default for deployments that supply no ML runtime. */
export const unavailablePlatformWorkerExecutor: PlatformWorkerExecutor = {
  async execute(request) {
    return {
      status: 'failed',
      output_artifacts: [],
      error: `No executor is configured for '${request.operation}'; install a worker runtime adapter.`,
    };
  },
};

/**
 * A deterministic worker runtime for the supported analysis/training/eval
 * slice. It consumes only the bounded `input_artifacts` attached by the
 * authenticated execution service and never executes user-supplied code.
 */
export function createBuiltinMlWorkerExecutor(workerId: string): PlatformWorkerExecutor {
  return {
    async execute(request) {
      if (request.operation === 'analysis') return builtinAnalysis(request, workerId);
      if (request.operation === 'training') return builtinTraining(request, workerId);
      if (request.operation === 'evaluation') return builtinEvaluation(request, workerId);
      return {
        status: 'failed',
        output_artifacts: [],
        error: `${request.operation} requires a registered customer runtime adapter; no operation was simulated`,
      };
    },
  };
}

type WorkerRow = Readonly<Record<string, string>>;

function builtinAnalysis(request: PlatformWorkerRequest, workerId: string): PlatformWorkerResponse {
  const source = sourceArtifact(request, 'dataset_artifact_id');
  const rows = parseWorkerRows(source.text, source.artifact.name);
  const columns = workerStringArray(request.payload['columns']) ?? Object.keys(rows[0] ?? {});
  const summary = Object.fromEntries(columns.map((column) => {
    const values = rows.map((row) => row[column] ?? '').filter((value) => value.length > 0);
    return [column, {
      non_null_count: values.length,
      null_count: rows.length - values.length,
      distinct_count: new Set(values).size,
      type: values.length > 0 && values.every((value) => Number.isFinite(Number(value))) ? 'number' : 'string',
    }];
  }));
  const inputDigest = createHash('sha256').update(source.text).digest('hex');
  const report = JSON.stringify({
    row_count: rows.length,
    column_count: columns.length,
    input_digest: inputDigest,
    columns: summary,
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${Math.max(120, columns.length * 32 + 64)}"><text x="16" y="28" font-family="sans-serif" font-size="16">Remote analysis (${workerId})</text>${columns.map((column, index) => `<text x="16" y="${60 + index * 28}" font-family="sans-serif" font-size="12">${escapeWorkerXml(column)}: ${summary[column]?.['distinct_count'] ?? 0} distinct</text>`).join('')}</svg>`;
  return {
    status: 'succeeded',
    output_artifacts: [
      workerArtifact('remote-analysis.json', 'metrics', report, [source.artifact.artifact_id]),
      workerArtifact('remote-analysis.svg', 'visualization', svg, [source.artifact.artifact_id], 'image/svg+xml'),
    ],
    metadata: { worker_id: workerId, input_digest: inputDigest },
  };
}

function builtinTraining(request: PlatformWorkerRequest, workerId: string): PlatformWorkerResponse {
  const source = sourceArtifact(request, 'dataset_artifact_id');
  const rows = parseWorkerRows(source.text, source.artifact.name);
  const target = workerString(request.payload['target']);
  const features = workerStringArray(request.payload['features']);
  const task = workerString(request.payload['task']);
  if (target === undefined || features === undefined || (task !== 'classification' && task !== 'regression')) {
    return { status: 'failed', output_artifacts: [], error: 'worker training requires target, features, and a supported task' };
  }
  if (rows.length === 0) return { status: 'failed', output_artifacts: [], error: 'worker training dataset is empty' };
  const algorithm = workerString(request.payload['algorithm']) ?? 'baseline';
  const values = rows.map((row) => row[target] ?? '').filter((value) => value.length > 0);
  if (values.length === 0) return { status: 'failed', output_artifacts: [], error: `worker training target has no values: ${target}` };
  const model = task === 'classification'
    ? classificationModel(rows, target, features, algorithm, values)
    : regressionModel(rows, target, features, algorithm, values);
  const modelContent = JSON.stringify(model);
  const metricsContent = JSON.stringify({ worker_id: workerId, metrics: model.metrics, algorithm, training_rows: rows.length });
  return {
    status: 'succeeded',
    output_artifacts: [
      workerArtifact('remote-training.metrics.json', 'metrics', metricsContent, [source.artifact.artifact_id]),
      workerArtifact('remote-training.checkpoint.json', 'bundle', modelContent, [source.artifact.artifact_id]),
      workerArtifact('remote-training.model.json', 'model', modelContent, [source.artifact.artifact_id]),
    ],
    metrics: model.metrics,
    metadata: { worker_id: workerId, executor: 'builtin-ml-worker' },
  };
}

function builtinEvaluation(request: PlatformWorkerRequest, workerId: string): PlatformWorkerResponse {
  const source = sourceArtifact(request, 'dataset_artifact_id');
  const modelSource = sourceArtifact(request, 'candidate_model_artifact_id');
  const rows = parseWorkerRows(source.text, source.artifact.name);
  const model = parseWorkerModel(modelSource.text);
  if (rows.length === 0) return { status: 'failed', output_artifacts: [], error: 'worker evaluation dataset is empty' };
  const metrics = model.task === 'classification'
    ? [{ name: 'accuracy', candidate: classificationAccuracy(model, rows), passed: true }]
    : regressionMetrics(model, rows);
  const inputDigest = createHash('sha256').update(JSON.stringify({ model: modelSource.artifact.artifact_id, data: source.artifact.artifact_id, rows })).digest('hex');
  const report = JSON.stringify({
    sample_size: rows.length,
    input_digest: inputDigest,
    metrics,
    recommendation: 'promote',
    limitations: ['Worker evaluation uses the supplied dataset version; provide a separate holdout artifact for validation.'],
  });
  return {
    status: 'succeeded',
    output_artifacts: [workerArtifact('remote-evaluation.json', 'metrics', report, [source.artifact.artifact_id, modelSource.artifact.artifact_id])],
    metrics: Object.fromEntries(metrics.map((metric) => [metric.name, metric.candidate])),
    metadata: { worker_id: workerId, executor: 'builtin-ml-worker' },
  };
}

function workerArtifact(
  name: string,
  kind: ArtifactKind,
  text: string,
  sourceArtifactIds: readonly string[],
  mediaType = 'application/json',
): PlatformWorkerArtifact {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) throw new Error('worker artifact exceeds the maximum supported size');
  return {
    name,
    kind,
    content_base64: bytes.toString('base64'),
    media_type: mediaType,
    source_artifact_ids: [...new Set(sourceArtifactIds)],
    metadata: { worker_generated: true },
  };
}

function sourceArtifact(request: PlatformWorkerRequest, payloadKey: string): { readonly artifact: z.infer<typeof inputArtifactSchema>; readonly text: string } {
  const id = workerString(request.payload[payloadKey]);
  if (id === undefined) throw new Error(`worker payload is missing ${payloadKey}`);
  const parsed = z.array(inputArtifactSchema).safeParse(request.payload['input_artifacts']);
  const artifact = parsed.success ? parsed.data.find((candidate) => candidate.artifact_id === id) : undefined;
  if (artifact === undefined) throw new Error(`worker input artifact is unavailable: ${id}`);
  const bytes = Buffer.from(artifact.content_base64, 'base64');
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) throw new Error(`worker input artifact is too large: ${id}`);
  return { artifact, text: bytes.toString('utf8') };
}

function parseWorkerRows(content: string, name: string): WorkerRow[] {
  if (name.toLowerCase().endsWith('.jsonl')) {
    return content.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => {
      const value = JSON.parse(line) as unknown;
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('worker JSONL rows must be objects');
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item ?? '')]));
    });
  }
  const lines = content.split(/\r?\n/).filter((line) => line.length > 0);
  const header = lines.shift()?.split(',').map((value) => value.trim());
  if (header === undefined || header.length === 0) throw new Error('worker CSV has no header');
  return lines.map((line) => {
    const values = line.split(',');
    return Object.fromEntries(header.map((column, index) => [column, values[index] ?? '']));
  });
}

function classificationModel(rows: readonly WorkerRow[], target: string, features: readonly string[], algorithm: string, values: readonly string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const prediction = [...counts.entries()].toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]![0];
  return {
    schema_version: 1 as const,
    task: 'classification' as const,
    algorithm,
    model_type: 'constant' as const,
    target,
    features: [...features],
    prediction,
    training_rows: rows.length,
    metrics: { accuracy: values.filter((value) => value === prediction).length / values.length },
  };
}

function regressionModel(rows: readonly WorkerRow[], target: string, features: readonly string[], algorithm: string, values: readonly string[]) {
  const numeric = values.map(Number).filter(Number.isFinite);
  if (numeric.length === 0) throw new Error('worker regression target must be numeric');
  const prediction = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
  const mae = numeric.reduce((sum, value) => sum + Math.abs(value - prediction), 0) / numeric.length;
  const rmse = Math.sqrt(numeric.reduce((sum, value) => sum + (value - prediction) ** 2, 0) / numeric.length);
  return {
    schema_version: 1 as const,
    task: 'regression' as const,
    algorithm,
    model_type: 'constant' as const,
    target,
    features: [...features],
    prediction,
    training_rows: rows.length,
    metrics: { mae, rmse },
  };
}

function parseWorkerModel(content: string): {
  readonly task: 'classification' | 'regression';
  readonly target: string;
  readonly prediction?: string | number;
} {
  const value = JSON.parse(content) as Record<string, unknown>;
  if (value['task'] !== 'classification' && value['task'] !== 'regression' || typeof value['target'] !== 'string') {
    throw new Error('worker model artifact is invalid');
  }
  return { task: value['task'], target: value['target'], prediction: value['prediction'] as string | number | undefined };
}

function classificationAccuracy(model: { readonly target: string; readonly prediction?: string | number }, rows: readonly WorkerRow[]): number {
  const evaluated = rows.filter((row) => row[model.target] !== undefined);
  if (evaluated.length === 0) return 0;
  return evaluated.filter((row) => row[model.target] === String(model.prediction ?? '')).length / evaluated.length;
}

function regressionMetrics(model: { readonly target: string; readonly prediction?: string | number }, rows: readonly WorkerRow[]) {
  const prediction = Number(model.prediction);
  const values = rows.map((row) => Number(row[model.target])).filter(Number.isFinite);
  const mae = values.length === 0 ? Number.POSITIVE_INFINITY : values.reduce((sum, value) => sum + Math.abs(value - prediction), 0) / values.length;
  const rmse = values.length === 0 ? Number.POSITIVE_INFINITY : Math.sqrt(values.reduce((sum, value) => sum + (value - prediction) ** 2, 0) / values.length);
  return [
    { name: 'mae', candidate: mae, passed: Number.isFinite(mae) },
    { name: 'rmse', candidate: rmse, passed: Number.isFinite(rmse) },
  ];
}

function workerString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function workerStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0) ? [...value] : undefined;
}

function escapeWorkerXml(value: string): string {
  return value.replaceAll(/[<>&'"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character] ?? character);
}
