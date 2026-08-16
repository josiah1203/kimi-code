import { KaosError, KaosValueError } from './errors';
import type { Kaos } from './kaos';
import type { KaosProcess } from './process';

/** Stable failure classifications for provider command adapters. */
export type ProviderCommandErrorCode =
  | 'executable_missing'
  | 'unsupported_version'
  | 'authentication_failure'
  | 'model_unavailable'
  | 'permission_denied'
  | 'timeout'
  | 'cancellation'
  | 'provider_rate_limit'
  | 'malformed_output'
  | 'nonzero_exit'
  | 'unsupported_capability'
  | 'duplicate_request';

export type ProviderStatusCode = 'available' | ProviderCommandErrorCode;

export interface ProviderStatus {
  readonly available: boolean;
  readonly code: ProviderStatusCode;
  readonly executable: string;
  readonly version: string | null;
  readonly message?: string;
}

export interface ModelInfo {
  readonly id: string;
  readonly displayName?: string;
  readonly contextWindow?: number;
  readonly capabilities?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface UsageMetadata {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cost?: number;
}

/** Secret-free provenance shared by provider CLI lifecycle events. */
export interface ProviderInvocationTrace {
  readonly runId: string;
  readonly attemptId: string;
  readonly workspaceId: string;
  readonly projectId?: string;
  readonly executionTargetId?: string;
  readonly provider: string;
  readonly model?: string;
  readonly userId?: string;
  readonly policyDecisionIds?: readonly string[];
  readonly approvalIds?: readonly string[];
  readonly artifactIds?: readonly string[];
  readonly usageRecordIds?: readonly string[];
}

export interface ProviderRequest {
  /** A caller-owned identifier used for cancellation and audit correlation. */
  readonly requestId: string;
  /** Required for durable provider execution; omitted only by standalone probes. */
  readonly trace?: ProviderInvocationTrace;
  /** Cancels the child process and resolves as a classified cancellation. */
  readonly signal?: AbortSignal;
  /** Prompt text is sent through stdin and is never placed in argv. */
  readonly prompt: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly cwd?: string;
  /** Provider CLI environment overrides. Values are redacted from diagnostics. */
  readonly env?: Readonly<Record<string, string>>;
  /** Provider-specific flags appended as argv; no shell parsing is performed. */
  readonly flags?: readonly string[];
}

export type ProviderEvent =
  | {
      readonly kind: 'started';
      readonly requestId: string;
      readonly trace?: ProviderInvocationTrace;
    }
  | {
      readonly kind: 'text';
      readonly requestId: string;
      readonly text: string;
      readonly trace?: ProviderInvocationTrace;
    }
  | {
      readonly kind: 'usage';
      readonly requestId: string;
      readonly usage: UsageMetadata;
      readonly trace?: ProviderInvocationTrace;
    }
  | {
      readonly kind: 'metadata';
      readonly requestId: string;
      readonly metadata: Readonly<Record<string, unknown>>;
      readonly trace?: ProviderInvocationTrace;
    }
  | {
      readonly kind: 'completed';
      readonly requestId: string;
      readonly exitCode: 0;
      readonly usage?: UsageMetadata;
      readonly trace?: ProviderInvocationTrace;
    };

export interface ProviderCapabilities {
  readonly available: boolean;
  readonly code: ProviderStatusCode;
  readonly streaming: boolean;
  readonly cancellation: boolean;
  readonly modelSelection: boolean;
  readonly modelListing: boolean;
  readonly structuredOutput: boolean;
  readonly nonInteractive: boolean;
  readonly usageMetadata: boolean;
  readonly supportedVersionRange?: string;
  readonly message?: string;
}

export interface ProviderCommandSpec {
  readonly id: string;
  readonly displayName: string;
  /** An executable name resolved through PATH or an explicitly configured path. */
  readonly executable: string;
  readonly versionArgs?: readonly string[];
  readonly modelsArgs?: readonly string[];
  /** Arguments for a non-interactive run. `{model}` is replaced without shell evaluation. */
  readonly runArgs: readonly string[];
  /** Input protocol used on stdin. */
  readonly input?: 'jsonl' | 'text' | 'none';
  /** The run command must emit one JSON object per line. */
  readonly output?: 'jsonl';
  /** Model-list command output protocol. */
  readonly modelsOutput?: 'json' | 'jsonl';
  readonly environment?: Readonly<Record<string, string>>;
  /** Additional in-memory values that must never appear in diagnostics or provider output. */
  readonly redactionSecrets?: readonly string[];
  readonly supportedVersionRange?: string;
  /** Numeric exit-code overrides, represented as string keys for JSON configuration. */
  readonly exitCodeMap?: Readonly<Record<string, ProviderCommandErrorCode>>;
  readonly capabilities?: Partial<
    Pick<
      ProviderCapabilities,
      'streaming' | 'cancellation' | 'modelSelection' | 'modelListing' | 'usageMetadata'
    >
  >;
  /** Maximum bytes retained from a single command's stdout or stderr. */
  readonly maxOutputBytes?: number;
}

export interface ProviderCommandAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly executable: string;

  detect(): Promise<ProviderStatus>;
  version(): Promise<string | null>;
  capabilities(): Promise<ProviderCapabilities>;
  models(): Promise<ModelInfo[]>;
  run(request: ProviderRequest): AsyncIterable<ProviderEvent>;
  cancel(requestId: string): Promise<void>;
}

export interface ProviderCommandErrorOptions {
  readonly providerId?: string;
  readonly requestId?: string;
  readonly exitCode?: number;
  readonly stderr?: string;
  readonly cause?: unknown;
}

interface InternalProviderCommandErrorOptions
  extends Omit<ProviderCommandErrorOptions, 'providerId' | 'requestId'> {
  readonly redactionSecrets?: readonly string[];
}

/** Error thrown by an adapter at a stable provider-command boundary. */
export class ProviderCommandError extends KaosError {
  readonly code: ProviderCommandErrorCode;
  readonly providerId: string | undefined;
  readonly requestId: string | undefined;
  readonly exitCode: number | undefined;
  readonly stderr: string | undefined;
  override readonly cause: unknown;

  constructor(
    code: ProviderCommandErrorCode,
    message: string,
    options: ProviderCommandErrorOptions = {},
  ) {
    super(`[${code}] ${message}`);
    this.name = 'ProviderCommandError';
    this.code = code;
    this.providerId = options.providerId;
    this.requestId = options.requestId;
    this.exitCode = options.exitCode;
    this.stderr = options.stderr;
    this.cause = options.cause;
  }
}

const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
const DEFAULT_RUN_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * Provider-neutral adapter backed by a Kaos process environment.
 *
 * The adapter only accepts argv and machine-readable JSONL output. It does
 * not invoke a shell and never attempts to scrape terminal decorations.
 */
export class LocalProviderCommandAdapter implements ProviderCommandAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly executable: string;

  private readonly _kaos: Kaos;
  private readonly _spec: NormalizedProviderCommandSpec;
  private readonly _active = new Map<string, ActiveRequest>();

  constructor(kaos: Kaos, spec: ProviderCommandSpec) {
    this._kaos = kaos;
    this._spec = normalizeSpec(spec);
    this.id = this._spec.id;
    this.displayName = this._spec.displayName;
    this.executable = this._spec.executable;
  }

  async detect(): Promise<ProviderStatus> {
    const result = await this._probeVersion();
    if (result.error !== undefined) {
      return {
        available: false,
        code: result.error.code,
        executable: this.executable,
        version: result.version,
        message: result.error.message,
      };
    }

    if (result.version === null) {
      return {
        available: false,
        code: 'malformed_output',
        executable: this.executable,
        version: null,
        message: 'The provider command did not emit a recognizable semantic version.',
      };
    }

    if (
      this._spec.supportedVersionRange !== undefined &&
      !isVersionSupported(result.version, this._spec.supportedVersionRange)
    ) {
      return {
        available: false,
        code: 'unsupported_version',
        executable: this.executable,
        version: result.version,
        message: `Version ${result.version} is outside the supported range ${this._spec.supportedVersionRange}.`,
      };
    }

    return {
      available: true,
      code: 'available',
      executable: this.executable,
      version: result.version,
    };
  }

  async version(): Promise<string | null> {
    const result = await this._probeVersion();
    return result.version;
  }

  async capabilities(): Promise<ProviderCapabilities> {
    const status = await this.detect();
    const available = status.available;
    const overrides = this._spec.capabilities ?? {};
    return {
      available,
      code: status.code,
      streaming: available && (overrides.streaming ?? false),
      cancellation: available && (overrides.cancellation ?? true),
      modelSelection:
        available && (overrides.modelSelection ?? this._spec.runArgs.some(hasModelPlaceholder)),
      modelListing: available && (overrides.modelListing ?? this._spec.modelsArgs !== undefined),
      structuredOutput: available,
      nonInteractive: available,
      usageMetadata: available && (overrides.usageMetadata ?? false),
      ...(this._spec.supportedVersionRange === undefined
        ? {}
        : { supportedVersionRange: this._spec.supportedVersionRange }),
      ...(status.message === undefined ? {} : { message: status.message }),
    };
  }

  async models(): Promise<ModelInfo[]> {
    if (this._spec.modelsArgs === undefined) {
      throw this._error('unsupported_capability', 'This provider command has no model-list command.');
    }

    const result = await this._runSimple(this._spec.modelsArgs, DEFAULT_PROBE_TIMEOUT_MS);
    return parseModels(
      result.stdout,
      this._spec.modelsOutput,
      this.id,
      this.redactionSecrets(),
    );
  }

  async *run(request: ProviderRequest): AsyncIterable<ProviderEvent> {
    validateRequest(request);
    if (request.signal?.aborted === true) {
      throw this._error('cancellation', 'The provider request was cancelled.', request.requestId);
    }
    if (this._active.has(request.requestId)) {
      throw this._error(
        'duplicate_request',
        `A provider request with id ${request.requestId} is already running.`,
        request.requestId,
      );
    }

    const command = [
      this.executable,
      ...renderArgs(this._spec.runArgs, request.model),
      ...(request.flags ?? []),
    ];
    const runner = request.cwd === undefined ? this._kaos : this._kaos.withCwd(request.cwd);
    const providerEnvironment = mergeEnvironment(this._spec.environment, request.env);
    const redactionSecrets = this.redactionSecrets(providerEnvironment);
    let processHandle: KaosProcess;
    try {
      processHandle = await runner.execWithEnv(
        command,
        providerEnvironment,
      );
    } catch (error) {
      throw this._spawnError(error, request.requestId);
    }

    const active: ActiveRequest = {
      process: processHandle,
      cancelled: false,
      timedOut: false,
      finished: false,
    };
    this._active.set(request.requestId, active);
    const onAbort = () => {
      active.cancelled = true;
      void processHandle.kill().catch(() => undefined);
    };
    request.signal?.addEventListener('abort', onAbort, { once: true });
    if (request.signal?.aborted) onAbort();
    const stderrPromise = collectStream(processHandle.stderr, this._spec.maxOutputBytes);
    const timeoutMs = request.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    const timer = setTimeout(() => {
      active.timedOut = true;
      void processHandle.kill().catch(() => undefined);
    }, timeoutMs);
    active.timer = timer;

    let accumulatedText = '';
    let usage: UsageMetadata | undefined;
    let completed = false;

    try {
      yield { kind: 'started', requestId: request.requestId, ...traceField(request.trace) };
      await writeRequestInput(processHandle, this._spec.input, request);

      for await (const line of readBoundedLines(
        processHandle.stdout,
        this._spec.maxOutputBytes,
        this.id,
        request.requestId,
      )) {
        if (line.trim().length === 0) continue;
        const parsed = parseProviderEvent(
          line,
          request.requestId,
          this.id,
          request.trace,
          redactionSecrets,
        );
        if (parsed.kind === 'text') accumulatedText += parsed.text;
        if (parsed.kind === 'usage') usage = parsed.usage;
        if (parsed.kind === 'completed') {
          completed = true;
          if (parsed.usage !== undefined) usage = parsed.usage;
          continue;
        }
        yield parsed;
      }

      const exitCode = await processHandle.wait();
      const stderr = await stderrPromise;
      if (active.cancelled) {
        throw this._error('cancellation', 'The provider request was cancelled.', request.requestId, {
          stderr,
          redactionSecrets,
        });
      }
      if (active.timedOut) {
        throw this._error(
          'timeout',
          `The provider request exceeded its ${String(timeoutMs)}ms timeout.`,
          request.requestId,
          {
            stderr,
            redactionSecrets,
          },
        );
      }
      if (exitCode !== 0) {
        throw this._classifyExit(
          exitCode,
          stderr,
          request.requestId,
          redactionSecrets,
        );
      }

      // A provider may omit an explicit `done` event. Successful process exit
      // is still a valid completion once every output line was structured.
      if (!completed) completed = true;
      if (completed) {
        yield {
          kind: 'completed',
          requestId: request.requestId,
          exitCode: 0,
          ...traceField(request.trace),
          ...(usage === undefined ? {} : { usage }),
        };
      }
      void accumulatedText;
    } catch (error) {
      if (error instanceof ProviderCommandError) throw error;
      const stderr = await settledValue(stderrPromise);
      if (active.cancelled) {
        throw this._error('cancellation', 'The provider request was cancelled.', request.requestId, {
          stderr,
          redactionSecrets,
          cause: error,
        });
      }
      if (active.timedOut) {
        throw this._error(
          'timeout',
          `The provider request exceeded its ${String(timeoutMs)}ms timeout.`,
          request.requestId,
          { stderr, redactionSecrets, cause: error },
        );
      }
      throw this._error(
        'nonzero_exit',
        `Provider command failed: ${redactSecrets(errorMessage(error), redactionSecrets)}`,
        request.requestId,
        {
          stderr,
          cause: error,
          redactionSecrets,
        },
      );
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
      active.finished = true;
      this._active.delete(request.requestId);
      if (!active.cancelled && !active.timedOut && processHandle.exitCode === null) {
        await processHandle.kill().catch(() => undefined);
      }
      await settledValue(processHandle.wait());
      await settledValue(stderrPromise);
      await processHandle.dispose();
    }
  }

  async cancel(requestId: string): Promise<void> {
    const active = this._active.get(requestId);
    if (active === undefined || active.finished) return;
    active.cancelled = true;
    await active.process.kill();
  }

  private async _probeVersion(): Promise<{
    readonly version: string | null;
    readonly error?: ProviderCommandError;
  }> {
    try {
      const result = await this._runSimple(this._spec.versionArgs, DEFAULT_PROBE_TIMEOUT_MS);
      return { version: extractVersion(result.stdout) };
    } catch (error) {
      if (error instanceof ProviderCommandError) {
        return { version: null, error };
      }
      return {
        version: null,
        error: this._error('nonzero_exit', errorMessage(error), undefined, { cause: error }),
      };
    }
  }

  private async _runSimple(
    args: readonly string[],
    timeoutMs: number,
  ): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }> {
    const command = [this.executable, ...args];
    let processHandle: KaosProcess;
    try {
      processHandle = await this._kaos.execWithEnv(
        command,
        mergeEnvironment(this._spec.environment, undefined),
      );
    } catch (error) {
      throw this._spawnError(error);
    }

    const stdoutPromise = collectStream(processHandle.stdout, this._spec.maxOutputBytes);
    const stderrPromise = collectStream(processHandle.stderr, this._spec.maxOutputBytes);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void processHandle.kill().catch(() => undefined);
    }, timeoutMs);

    try {
      const exitCode = await processHandle.wait();
      const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
      if (timedOut) {
        throw this._error('timeout', `The provider command exceeded its ${String(timeoutMs)}ms timeout.`, undefined, {
          stderr,
        });
      }
      if (exitCode !== 0) throw this._classifyExit(exitCode, stderr);
      return { stdout, stderr, exitCode };
    } catch (error) {
      if (timedOut && !(error instanceof ProviderCommandError && error.code === 'timeout')) {
        throw this._error('timeout', `The provider command exceeded its ${String(timeoutMs)}ms timeout.`, undefined, {
          cause: error,
        });
      }
      if (error instanceof ProviderCommandError) throw error;
      throw this._error('nonzero_exit', errorMessage(error), undefined, { cause: error });
    } finally {
      clearTimeout(timer);
      if (processHandle.exitCode === null) await processHandle.kill().catch(() => undefined);
      await settledValue(processHandle.wait());
      await settledValue(stdoutPromise);
      await settledValue(stderrPromise);
      await processHandle.dispose();
    }
  }

  private _spawnError(error: unknown, requestId?: string): ProviderCommandError {
    const errno = error as NodeJS.ErrnoException;
    const code = errno.code === 'ENOENT'
      ? 'executable_missing'
      : errno.code === 'EACCES'
        ? 'permission_denied'
        : 'nonzero_exit';
    const message = code === 'executable_missing'
      ? `Provider executable "${this.executable}" was not found on PATH or at its configured path.`
      : code === 'permission_denied'
        ? `Provider executable "${this.executable}" is not executable.`
        : `Provider executable "${this.executable}" could not be started.`;
    return this._error(code, message, requestId, { cause: error });
  }

  private _classifyExit(
    exitCode: number,
    stderr: string,
    requestId?: string,
    redactionSecrets: readonly string[] = [],
  ): ProviderCommandError {
    const mapped = this._spec.exitCodeMap[String(exitCode)];
    const code = mapped ?? classifyStderr(stderr, exitCode);
    const safeStderr = redactSecrets(stderr, redactionSecrets);
    return this._error(
      code,
      `Provider command exited with code ${String(exitCode)}${safeStderr.length > 0 ? `: ${safeStderr}` : '.'}`,
      requestId,
      { exitCode, stderr: safeStderr, redactionSecrets },
    );
  }

  private _error(
    code: ProviderCommandErrorCode,
    message: string,
    requestId?: string,
    options: InternalProviderCommandErrorOptions = {},
  ): ProviderCommandError {
    const { redactionSecrets, stderr, ...publicOptions } = options;
    const secrets = [...this.redactionSecrets(), ...(redactionSecrets ?? [])];
    return new ProviderCommandError(code, redactSecrets(message, secrets), {
      ...publicOptions,
      ...(stderr === undefined ? {} : { stderr: redactSecrets(stderr, secrets) }),
      providerId: this.id,
      ...(requestId === undefined ? {} : { requestId }),
    });
  }

  private redactionSecrets(
    environment?: Readonly<Record<string, string>>,
  ): readonly string[] {
    return [
      ...secretValues(this._spec.environment),
      ...secretValues(environment),
      ...(this._spec.redactionSecrets ?? []),
    ];
  }
}

interface NormalizedProviderCommandSpec extends ProviderCommandSpec {
  readonly versionArgs: readonly string[];
  readonly input: 'jsonl' | 'text' | 'none';
  readonly output: 'jsonl';
  readonly modelsOutput: 'json' | 'jsonl';
  readonly environment: Readonly<Record<string, string>>;
  readonly exitCodeMap: Readonly<Record<string, ProviderCommandErrorCode>>;
  readonly maxOutputBytes: number;
}

interface ActiveRequest {
  readonly process: KaosProcess;
  cancelled: boolean;
  timedOut: boolean;
  finished: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

function normalizeSpec(spec: ProviderCommandSpec): NormalizedProviderCommandSpec {
  if (spec.id.trim().length === 0) throw new KaosValueError('Provider command id cannot be empty.');
  if (spec.displayName.trim().length === 0) {
    throw new KaosValueError(`Provider command ${spec.id} must have a display name.`);
  }
  if (spec.executable.trim().length === 0) {
    throw new KaosValueError(`Provider command ${spec.id} must have an executable.`);
  }
  if (spec.runArgs.some((arg) => arg.includes('{') && !isSupportedTemplate(arg))) {
    throw new KaosValueError(`Provider command ${spec.id} contains an unsupported argument template.`);
  }
  if (spec.maxOutputBytes !== undefined && spec.maxOutputBytes <= 0) {
    throw new KaosValueError(`Provider command ${spec.id} maxOutputBytes must be positive.`);
  }
  return {
    ...spec,
    versionArgs: spec.versionArgs ?? ['--version'],
    input: spec.input ?? 'jsonl',
    output: spec.output ?? 'jsonl',
    modelsOutput: spec.modelsOutput ?? 'json',
    environment: spec.environment ?? {},
    exitCodeMap: spec.exitCodeMap ?? {},
    maxOutputBytes: spec.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  };
}

function validateRequest(request: ProviderRequest): void {
  if (request.requestId.trim().length === 0) throw new KaosValueError('Provider requestId cannot be empty.');
  if (request.timeoutMs !== undefined && request.timeoutMs <= 0) {
    throw new KaosValueError('Provider request timeoutMs must be positive.');
  }
}

function renderArgs(args: readonly string[], model: string | undefined): string[] {
  return args.map((arg) => arg.replaceAll('{model}', model ?? ''));
}

function isSupportedTemplate(arg: string): boolean {
  return /^([^{}]|\{model\})*$/.test(arg);
}

function hasModelPlaceholder(arg: string): boolean {
  return arg.includes('{model}');
}

function mergeEnvironment(
  base: Readonly<Record<string, string>> | undefined,
  overrides: Readonly<Record<string, string>> | undefined,
): Record<string, string> | undefined {
  if (base === undefined && overrides === undefined) return undefined;
  return { ...base, ...overrides };
}

async function writeRequestInput(
  processHandle: KaosProcess,
  input: 'jsonl' | 'text' | 'none',
  request: ProviderRequest,
): Promise<void> {
  if (input === 'none') {
    processHandle.stdin.end();
    return;
  }
  const value = input === 'jsonl'
    ? `${JSON.stringify({ requestId: request.requestId, prompt: request.prompt, model: request.model ?? null })}\n`
    : `${request.prompt}\n`;
  processHandle.stdin.end(value);
}

async function collectStream(stream: AsyncIterable<unknown>, maxBytes: number): Promise<string> {
  let bytes = 0;
  let text = '';
  for await (const chunk of stream) {
    const piece = typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8');
    bytes += Buffer.byteLength(piece, 'utf8');
    if (bytes > maxBytes) {
      throw new ProviderCommandError(
        'malformed_output',
        `Provider command output exceeded the ${String(maxBytes)} byte safety limit.`,
      );
    }
    text += piece;
  }
  return text;
}

async function* readBoundedLines(
  stream: AsyncIterable<unknown>,
  maxBytes: number,
  providerId: string,
  requestId: string,
): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let bytes = 0;
  let pending = '';
  for await (const chunk of stream) {
    const buffer = typeof chunk === 'string'
      ? Buffer.from(chunk, 'utf8')
      : Buffer.from(chunk as Uint8Array);
    bytes += buffer.byteLength;
    if (bytes > maxBytes) {
      throw new ProviderCommandError(
        'malformed_output',
        `Provider command output exceeded the ${String(maxBytes)} byte safety limit.`,
        { providerId, requestId },
      );
    }
    pending += decoder.decode(buffer, { stream: true });
    for (;;) {
      const newline = pending.indexOf('\n');
      if (newline < 0) break;
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      yield line.endsWith('\r') ? line.slice(0, -1) : line;
    }
  }
  pending += decoder.decode();
  if (pending.length > 0) yield pending;
}

async function settledValue<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise;
  } catch {
    return undefined;
  }
}

function parseModels(
  output: string,
  format: 'json' | 'jsonl',
  providerId: string,
  redactionSecrets: readonly string[] = [],
): ModelInfo[] {
  const values: unknown[] = [];
  if (format === 'jsonl') {
    for (const line of output.split(/\r?\n/)) {
      if (line.trim().length === 0) continue;
      values.push(parseJson(line, providerId));
    }
  } else {
    values.push(parseJson(output, providerId));
  }

  const items = values.length === 1 && isRecord(values[0]) && Array.isArray(values[0]['models'])
    ? values[0]['models']
    : values;
  const models: ModelInfo[] = [];
  for (const value of items) {
    const model = toModelInfo(redactProviderValue(value, redactionSecrets));
    if (model === undefined) {
      throw new ProviderCommandError(
        'malformed_output',
        `Provider ${providerId} returned a model entry without a string id.`,
      );
    }
    models.push(model);
  }
  return models;
}

function parseJson(value: string, providerId: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new ProviderCommandError(
      'malformed_output',
      `Provider ${providerId} returned non-JSON model output.`,
      { cause: error },
    );
  }
}

function toModelInfo(value: unknown): ModelInfo | undefined {
  if (!isRecord(value) || typeof value['id'] !== 'string' || value['id'].trim().length === 0) {
    return undefined;
  }
  const capabilities = Array.isArray(value['capabilities'])
    ? value['capabilities'].filter((item): item is string => typeof item === 'string')
    : undefined;
  const contextWindow = typeof value['contextWindow'] === 'number' ? value['contextWindow'] : undefined;
  const displayName = typeof value['displayName'] === 'string' ? value['displayName'] : undefined;
  return {
    id: value['id'],
    ...(displayName === undefined ? {} : { displayName }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(capabilities === undefined ? {} : { capabilities }),
    metadata: value,
  };
}

function parseProviderEvent(
  line: string,
  requestId: string,
  providerId: string,
  trace?: ProviderInvocationTrace,
  redactionSecrets: readonly string[] = [],
): ProviderEvent {
  const value = parseJson(line, providerId);
  if (!isRecord(value) || typeof value['type'] !== 'string') {
    throw new ProviderCommandError(
      'malformed_output',
      `Provider ${providerId} returned a JSON event without a type.`,
      { requestId },
    );
  }
  const type = value['type'];
  if (type === 'text' || type === 'delta') {
    const text = value['text'] ?? value['delta'];
    if (typeof text !== 'string') throw malformedEvent(providerId, requestId);
    return {
      kind: 'text',
      requestId,
      text: redactSecrets(text, redactionSecrets),
      ...traceField(trace),
    };
  }
  if (type === 'usage') {
    return { kind: 'usage', requestId, usage: parseUsage(value['usage'] ?? value), ...traceField(trace) };
  }
  if (type === 'metadata') {
    const metadata = value['metadata'];
    if (!isRecord(metadata)) throw malformedEvent(providerId, requestId);
    return {
      kind: 'metadata',
      requestId,
      metadata: redactProviderRecord(metadata, redactionSecrets),
      ...traceField(trace),
    };
  }
  if (type === 'done' || type === 'completed') {
    const rawUsage = value['usage'];
    return {
      kind: 'completed',
      requestId,
      exitCode: 0,
      ...traceField(trace),
      ...(rawUsage === undefined ? {} : { usage: parseUsage(rawUsage) }),
    };
  }
  if (type === 'result') {
    const text = value['text'];
    if (typeof text === 'string') {
      return {
        kind: 'text',
        requestId,
        text: redactSecrets(text, redactionSecrets),
        ...traceField(trace),
      };
    }
    throw malformedEvent(providerId, requestId);
  }
  if (type === 'error') {
    const rawMessage = value['message'];
    const message = typeof rawMessage === 'string' ? rawMessage : 'provider error';
    const code = providerErrorCode(value['code'], message);
    throw new ProviderCommandError(code, `Provider reported ${code}.`, { requestId });
  }
  throw new ProviderCommandError(
    'malformed_output',
    `Provider ${providerId} emitted unsupported event type ${type}.`,
    { requestId },
  );
}

function traceField(trace: ProviderInvocationTrace | undefined):
  { readonly trace?: ProviderInvocationTrace } {
  return trace === undefined ? {} : { trace };
}

function parseUsage(value: unknown): UsageMetadata {
  if (!isRecord(value)) throw new ProviderCommandError('malformed_output', 'Provider usage metadata was not an object.');
  const inputTokens = numberField(value, ['inputTokens', 'input_tokens', 'prompt_tokens']);
  const outputTokens = numberField(value, ['outputTokens', 'output_tokens', 'completion_tokens']);
  const totalTokens = numberField(value, ['totalTokens', 'total_tokens']);
  const cost = numberField(value, ['cost', 'total_cost']);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined && cost === undefined) {
    throw new ProviderCommandError('malformed_output', 'Provider usage metadata contained no numeric fields.');
  }
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(cost === undefined ? {} : { cost }),
  };
}

function numberField(value: Record<string, unknown>, names: readonly string[]): number | undefined {
  for (const name of names) {
    if (typeof value[name] === 'number' && Number.isFinite(value[name])) return value[name];
  }
  return undefined;
}

function malformedEvent(providerId: string, requestId: string): ProviderCommandError {
  return new ProviderCommandError(
    'malformed_output',
    `Provider ${providerId} emitted a malformed event.`,
    { requestId },
  );
}

function classifyStderr(stderr: string, exitCode: number): ProviderCommandErrorCode {
  const lower = stderr.toLowerCase();
  if (/(rate.?limit|too many requests|\b429\b)/i.test(lower) || exitCode === 429) {
    return 'provider_rate_limit';
  }
  if (/(unauthori[sz]ed|authentication|invalid api key|api key required|not logged in|login required)/i.test(lower)) {
    return 'authentication_failure';
  }
  if (/(model.*(not found|unavailable|unknown)|unknown model|model id)/i.test(lower)) {
    return 'model_unavailable';
  }
  if (/(permission denied|operation not permitted|eacces)/i.test(lower) || exitCode === 126) {
    return 'permission_denied';
  }
  if (/(unsupported|not supported|unknown option|unrecognized option)/i.test(lower)) {
    return 'unsupported_capability';
  }
  return 'nonzero_exit';
}

function providerErrorCode(value: unknown, message: string): ProviderCommandErrorCode {
  const candidates = [value, message].filter((item): item is string => typeof item === 'string');
  for (const candidate of candidates) {
    if (candidate === 'authentication_failure' || /auth|api key|login/i.test(candidate)) {
      return 'authentication_failure';
    }
    if (candidate === 'model_unavailable' || /model.*(unavailable|not found)|unknown model/i.test(candidate)) {
      return 'model_unavailable';
    }
    if (candidate === 'provider_rate_limit' || /rate.?limit|429/i.test(candidate)) {
      return 'provider_rate_limit';
    }
    if (candidate === 'unsupported_capability' || /unsupported|not supported/i.test(candidate)) {
      return 'unsupported_capability';
    }
  }
  return 'nonzero_exit';
}

function secretValues(values: Readonly<Record<string, string>> | undefined): readonly string[] {
  return Object.entries(values ?? {})
    .filter(([key, value]) => isSecretKey(key) && value.length > 0)
    .map(([, value]) => value);
}

function isSecretKey(key: string): boolean {
  return /(api[_-]?key|token|secret|password|credential|authorization|private[_-]?key)/i.test(key);
}

export function redactSecrets(value: string, secrets: readonly string[] = []): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret.length > 0) redacted = redacted.replaceAll(secret, '[REDACTED]');
  }
  return redacted
    .replaceAll(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, '$1[REDACTED]')
    .replaceAll(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

/** Redact configured provider credentials from structured provider output. */
function redactProviderValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') return redactSecrets(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactProviderValue(item, secrets));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, redactProviderValue(nested, secrets)]),
    );
  }
  return value;
}

function redactProviderRecord(
  value: Record<string, unknown>,
  secrets: readonly string[],
): Record<string, unknown> {
  return redactProviderValue(value, secrets) as Record<string, unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** Extracts a semantic version from a conventional `--version` response. */
export function extractVersion(output: string): string | null {
  const match = output.match(/(?:^|[^\d])v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:$|[^\d])/m);
  return match === null ? null : `${match[1]}.${match[2]}.${match[3]}`;
}

/** Supports the common exact, caret, tilde, and comparator range forms. */
export function isVersionSupported(version: string, range: string): boolean {
  const actual = parseSemver(version);
  if (actual === undefined) return false;
  return range.split('||').some((alternative) => {
    const tokens = alternative.trim().split(/\s+/).filter((token) => token.length > 0);
    if (tokens.length === 0 || tokens.includes('*')) return true;
    return tokens.every((token) => satisfiesComparator(actual, token));
  });
}

function parseSemver(value: string): Semver | undefined {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (match === null) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function satisfiesComparator(actual: Semver, token: string): boolean {
  const prefix = token.match(/^(\^|~|>=|<=|>|<|=)?v?(\d+\.\d+\.\d+)$/);
  if (prefix === null) return false;
  const operator = prefix[1] ?? '=';
  const version = prefix[2];
  if (version === undefined) return false;
  const expected = parseSemver(version);
  if (expected === undefined) return false;
  const comparison = compareSemver(actual, expected);
  if (operator === '=') return comparison === 0;
  if (operator === '>') return comparison > 0;
  if (operator === '>=') return comparison >= 0;
  if (operator === '<') return comparison < 0;
  if (operator === '<=') return comparison <= 0;
  if (operator === '~') {
    return comparison >= 0 && actual.major === expected.major && actual.minor === expected.minor;
  }
  const upper = expected.major === 0
    ? { major: 0, minor: expected.minor + 1, patch: 0 }
    : { major: expected.major + 1, minor: 0, patch: 0 };
  return comparison >= 0 && compareSemver(actual, upper) < 0;
}

function compareSemver(left: Semver, right: Semver): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function classifyErrorCode(code: string | undefined): ProviderCommandErrorCode | undefined {
  const valid: readonly ProviderCommandErrorCode[] = [
    'executable_missing',
    'unsupported_version',
    'authentication_failure',
    'model_unavailable',
    'permission_denied',
    'timeout',
    'cancellation',
    'provider_rate_limit',
    'malformed_output',
    'nonzero_exit',
    'unsupported_capability',
    'duplicate_request',
  ];
  return code !== undefined && valid.includes(code as ProviderCommandErrorCode)
    ? (code as ProviderCommandErrorCode)
    : undefined;
}

export function parseProviderCommandSpec(value: unknown): ProviderCommandSpec {
  if (!isRecord(value)) throw new KaosValueError('Provider CLI configuration entries must be objects.');
  const id = stringField(value, 'id');
  const displayName = stringField(value, 'displayName');
  const executable = stringField(value, 'executable');
  const runArgs = stringArrayField(value, 'runArgs') ?? [];
  const versionArgs = stringArrayField(value, 'versionArgs');
  const modelsArgs = stringArrayField(value, 'modelsArgs');
  const input = value['input'];
  if (input !== undefined && input !== 'jsonl' && input !== 'text' && input !== 'none') {
    throw new KaosValueError(`Provider CLI ${id} has an invalid input protocol.`);
  }
  const output = value['output'];
  if (output !== undefined && output !== 'jsonl') {
    throw new KaosValueError(`Provider CLI ${id} must use JSONL run output.`);
  }
  const modelsOutput = value['modelsOutput'];
  if (modelsOutput !== undefined && modelsOutput !== 'json' && modelsOutput !== 'jsonl') {
    throw new KaosValueError(`Provider CLI ${id} has an invalid modelsOutput protocol.`);
  }
  const environment = recordStringField(value, 'environment');
  const supportedVersionRange = optionalStringField(value, 'supportedVersionRange');
  const exitCodeMap = parseExitCodeMap(value['exitCodeMap']);
  const capabilities = parseCapabilityOverrides(value['capabilities']);
  const maxOutputBytes = value['maxOutputBytes'];
  if (maxOutputBytes !== undefined && (typeof maxOutputBytes !== 'number' || maxOutputBytes <= 0)) {
    throw new KaosValueError(`Provider CLI ${id} maxOutputBytes must be a positive number.`);
  }
  return {
    id,
    displayName,
    executable,
    runArgs,
    ...(versionArgs === undefined ? {} : { versionArgs }),
    ...(modelsArgs === undefined ? {} : { modelsArgs }),
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(modelsOutput === undefined ? {} : { modelsOutput }),
    ...(environment === undefined ? {} : { environment }),
    ...(supportedVersionRange === undefined ? {} : { supportedVersionRange }),
    ...(exitCodeMap === undefined ? {} : { exitCodeMap }),
    ...(capabilities === undefined ? {} : { capabilities }),
    ...(maxOutputBytes === undefined ? {} : { maxOutputBytes }),
  };
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== 'string' || field.trim().length === 0) {
    throw new KaosValueError(`Provider CLI configuration field ${key} must be a non-empty string.`);
  }
  return field;
}

function optionalStringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  if (field === undefined) return undefined;
  if (typeof field !== 'string') throw new KaosValueError(`Provider CLI configuration field ${key} must be a string.`);
  return field;
}

function stringArrayField(value: Record<string, unknown>, key: string): string[] | undefined {
  const field = value[key];
  if (field === undefined) return undefined;
  if (!Array.isArray(field) || field.some((item) => typeof item !== 'string')) {
    throw new KaosValueError(`Provider CLI configuration field ${key} must be an array of strings.`);
  }
  return field;
}

function recordStringField(
  value: Record<string, unknown>,
  key: string,
): Record<string, string> | undefined {
  const field = value[key];
  if (field === undefined) return undefined;
  if (!isRecord(field) || Object.values(field).some((item) => typeof item !== 'string')) {
    throw new KaosValueError(`Provider CLI configuration field ${key} must be an object of strings.`);
  }
  return field as Record<string, string>;
}

function parseExitCodeMap(value: unknown): Record<string, ProviderCommandErrorCode> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new KaosValueError('Provider CLI exitCodeMap must be an object.');
  const result: Record<string, ProviderCommandErrorCode> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== 'string') throw new KaosValueError(`Provider CLI exitCodeMap[${key}] must be a string.`);
    const code = classifyErrorCode(raw);
    if (code === undefined) throw new KaosValueError(`Provider CLI exitCodeMap[${key}] has an invalid error code.`);
    result[key] = code;
  }
  return result;
}

function parseCapabilityOverrides(
  value: unknown,
): ProviderCommandSpec['capabilities'] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new KaosValueError('Provider CLI capabilities must be an object.');
  const keys = ['streaming', 'cancellation', 'modelSelection', 'modelListing', 'usageMetadata'] as const;
  const result: Partial<Record<(typeof keys)[number], boolean>> = {};
  for (const key of keys) {
    const raw = value[key];
    if (raw !== undefined && typeof raw !== 'boolean') {
      throw new KaosValueError(`Provider CLI capabilities.${key} must be boolean.`);
    }
    if (raw !== undefined) result[key] = raw;
  }
  return result;
}
