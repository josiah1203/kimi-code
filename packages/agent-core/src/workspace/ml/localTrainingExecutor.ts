/**
 * Local ML executor bridge.
 *
 * A workspace may opt into a Python/ML environment by configuring
 * `SPIDERBYTE_ML_TRAIN_COMMAND`. The command is invoked directly (never through
 * a shell), receives one JSON request on stdin, and must return one JSON
 * response on stdout. This keeps the executor boundary explicit while the
 * durable Run and artifact records remain owned by SpiderByte Agent Core.
 */

import type { Readable } from 'node:stream';

import type { DatasetFormat, Experiment } from '@spiderbyte/protocol';

import type { IProcess, ISessionProcessRunner } from '#/session/process/processRunner';

const DEFAULT_TIMEOUT_MS = 24 * 60 * 60 * 1_000;
const MAX_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export interface LocalTrainingRequest {
  readonly schema_version: 1;
  readonly run_id: string;
  readonly experiment_id: string;
  readonly dataset_artifact_id: string;
  readonly dataset_content: string;
  readonly dataset_format: DatasetFormat;
  readonly dataset_csv: string;
  readonly task: Experiment['task'];
  readonly algorithm: string;
  readonly target: string;
  readonly features: readonly string[];
  readonly hyperparameters: Readonly<Record<string, unknown>>;
  readonly seed: number;
}

export interface LocalTrainingResult {
  readonly metrics: Readonly<Record<string, number>>;
  readonly model_content: string;
  readonly checkpoint_content?: string;
  readonly logs?: string;
  readonly environment?: Readonly<Record<string, unknown>>;
}

export interface LocalTrainingExecutorConfig {
  readonly command: string;
  readonly args: readonly string[];
  readonly timeout_ms: number;
}

export interface LocalTrainingExecutorOptions {
  readonly onProcess?: (process: IProcess) => void;
}

/** Returns the explicitly configured executor, or `undefined` for baseline ML. */
export function configuredLocalTrainingExecutor(): LocalTrainingExecutorConfig | undefined {
  const command = process.env['SPIDERBYTE_ML_TRAIN_COMMAND']?.trim();
  if (command === undefined || command.length === 0) return undefined;

  const args = parseArgs(process.env['SPIDERBYTE_ML_TRAIN_ARGS']);
  const timeout_ms = parseTimeout(process.env['SPIDERBYTE_ML_TRAIN_TIMEOUT_MS']);
  return { command, args, timeout_ms };
}

export async function executeLocalTraining(
  runner: ISessionProcessRunner,
  cwd: string,
  config: LocalTrainingExecutorConfig,
  request: LocalTrainingRequest,
  options?: LocalTrainingExecutorOptions,
): Promise<LocalTrainingResult> {
  let process: IProcess;
  try {
    process = await runner.exec([config.command, ...config.args], { cwd });
    options?.onProcess?.(process);
  } catch (error) {
    throw new Error(`local ML executor could not start: ${safeError(error)}`);
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void process.kill('SIGKILL').catch(() => undefined);
  }, config.timeout_ms);

  try {
    process.stdin.end(JSON.stringify(request));
    const [stdout, stderr, exitCode] = await Promise.all([
      readStreamWithCap(process.stdout, MAX_OUTPUT_BYTES),
      readStreamWithCap(process.stderr, MAX_OUTPUT_BYTES),
      process.wait().catch(() => -1),
    ]);
    if (timedOut) throw new Error('local ML executor timed out');
    if (exitCode !== 0) {
      throw new Error(`local ML executor exited with code ${exitCode}: ${safeError(stderr)}`);
    }
    return parseResult(stdout);
  } finally {
    clearTimeout(timer);
    await Promise.resolve(process.dispose()).catch(() => undefined);
  }
}

function parseArgs(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim().length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) {
      throw new Error('SPIDERBYTE_ML_TRAIN_ARGS must be a JSON array of strings');
    }
    return parsed;
  } catch (error) {
    throw new Error(`invalid local ML executor arguments: ${safeError(error)}`);
  }
}

function parseTimeout(raw: string | undefined): number {
  if (raw === undefined || raw.trim().length === 0) return DEFAULT_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    throw new Error(`SPIDERBYTE_ML_TRAIN_TIMEOUT_MS must be an integer between 1 and ${MAX_TIMEOUT_MS}`);
  }
  return value;
}

function parseResult(stdout: string): LocalTrainingResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`local ML executor returned invalid JSON: ${safeError(error)}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('local ML executor response must be a JSON object');
  }
  const record = parsed as Record<string, unknown>;
  const metrics = parseMetrics(record['metrics']);
  const modelContent = parseContent(record['model_content_base64'], record['model'], 'model');
  const checkpointContent = record['checkpoint_content_base64'] === undefined && record['checkpoint'] === undefined
    ? undefined
    : parseContent(record['checkpoint_content_base64'], record['checkpoint'], 'checkpoint');
  const logs = typeof record['logs'] === 'string' ? record['logs'].slice(0, MAX_OUTPUT_BYTES) : undefined;
  const environment = parseRecord(record['environment']);
  return {
    metrics,
    model_content: modelContent,
    checkpoint_content: checkpointContent,
    logs,
    environment,
  };
}

function parseMetrics(value: unknown): Readonly<Record<string, number>> {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('local ML executor metrics must be an object');
  }
  const metrics: Record<string, number> = {};
  for (const [name, metric] of Object.entries(value as Record<string, unknown>)) {
    if (name.length === 0 || name.length > 160 || typeof metric !== 'number' || !Number.isFinite(metric)) {
      throw new Error(`local ML executor returned an invalid metric: ${name}`);
    }
    metrics[name] = metric;
  }
  return metrics;
}

function parseContent(base64: unknown, value: unknown, label: string): string {
  if (typeof base64 === 'string') {
    const content = Buffer.from(base64, 'base64');
    if (content.byteLength > 2 * 1024 * 1024) throw new Error(`local ML ${label} content is too large`);
    return content.toString('utf8');
  }
  if (value === undefined) throw new Error(`local ML executor did not return ${label} content`);
  let content: string;
  try {
    content = typeof value === 'string' ? value : JSON.stringify(value);
  } catch (error) {
    throw new Error(`local ML ${label} content is not serializable: ${safeError(error)}`);
  }
  if (content === undefined || Buffer.byteLength(content, 'utf8') > 2 * 1024 * 1024) {
    throw new Error(`local ML ${label} content is too large`);
  }
  return content;
}

function parseRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('local ML executor environment must be an object');
  }
  return value as Readonly<Record<string, unknown>>;
}

async function readStreamWithCap(stream: Readable, maxBytes: number): Promise<string> {
  let text = '';
  let bytes = 0;
  stream.setEncoding('utf8');
  for await (const chunk of stream) {
    const value = String(chunk);
    const remaining = maxBytes - bytes;
    if (remaining <= 0) continue;
    const encoded = Buffer.from(value, 'utf8');
    const selected = encoded.byteLength > remaining ? encoded.subarray(0, remaining) : encoded;
    text += selected.toString('utf8');
    bytes += selected.byteLength;
  }
  return text;
}

function safeError(error: unknown): string {
  return redactSensitiveText(error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, ' ')
    .slice(0, 800);
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"'`]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|secret)\s*[:=]\s*)[^\s"'`]+/gi, '$1[REDACTED]');
}
