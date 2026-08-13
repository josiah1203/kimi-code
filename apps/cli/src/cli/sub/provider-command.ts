import {
  LocalKaos,
  LocalProviderCommandAdapter,
  parseProviderCommandSpec,
  ProviderCommandError,
  type ModelInfo,
  type ProviderCapabilities,
  type ProviderCommandAdapter,
  type ProviderCommandErrorCode,
  type ProviderCommandSpec,
  type ProviderEvent,
  type ProviderRequest,
  type ProviderStatus,
} from '@spiderbyte/kaos';

export const PROVIDER_CLI_CONFIG_ENV = 'SPYDERBYTE_PROVIDER_CLI_CONFIG';

export interface ProviderCommandDeps {
  readonly stdout: { write(chunk: string): boolean };
  readonly stderr: { write(chunk: string): boolean };
  readonly env: NodeJS.ProcessEnv;
  readonly exit: (code: number) => never;
  readonly getProviderCommandAdapters?: () => Promise<readonly ProviderCommandAdapter[]>;
}

export interface ProviderCommandInspection {
  readonly id: string;
  readonly displayName: string;
  readonly executable: string;
  readonly status: ProviderStatus;
  readonly capabilities: ProviderCapabilities;
  readonly models: readonly ModelInfo[];
  readonly modelsError?: ProviderCommandErrorCode;
}

export interface ProviderCommandListOptions {
  readonly json: boolean;
}

export interface ProviderCommandDetectOptions {
  readonly json: boolean;
}

export interface ProviderCommandTestOptions {
  readonly model?: string;
  readonly prompt: string;
  readonly timeoutMs?: number;
  readonly json: boolean;
}

export function parseConfiguredProviderCommands(
  env: NodeJS.ProcessEnv,
): ProviderCommandSpec[] {
  const raw = env[PROVIDER_CLI_CONFIG_ENV];
  if (raw === undefined || raw.trim().length === 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${PROVIDER_CLI_CONFIG_ENV} must contain a JSON array of provider command definitions: ${errorMessage(error)}`,
      { cause: error },
    );
  }
  if (!Array.isArray(parsed)) {
    throw new TypeError(`${PROVIDER_CLI_CONFIG_ENV} must contain a JSON array.`);
  }
  const specs = parsed.map((entry) => parseProviderCommandSpec(entry));
  const ids = new Set<string>();
  for (const spec of specs) {
    if (ids.has(spec.id)) throw new Error(`Duplicate provider CLI id: ${spec.id}.`);
    ids.add(spec.id);
  }
  return specs;
}

export async function createConfiguredProviderCommandAdapters(
  env: NodeJS.ProcessEnv,
): Promise<readonly ProviderCommandAdapter[]> {
  const specs = parseConfiguredProviderCommands(env);
  if (specs.length === 0) return [];
  const kaos = await LocalKaos.create();
  return specs.map((spec) => new LocalProviderCommandAdapter(kaos, spec));
}

export async function inspectProviderCommand(
  adapter: ProviderCommandAdapter,
  includeModels: boolean,
): Promise<ProviderCommandInspection> {
  const status = await adapter.detect();
  const capabilities = await adapter.capabilities();
  let models: readonly ModelInfo[] = [];
  let modelsError: ProviderCommandErrorCode | undefined;
  if (includeModels && capabilities.modelListing && status.available) {
    try {
      models = await adapter.models();
    } catch (error) {
      modelsError = providerCommandErrorCode(error);
    }
  }
  return {
    id: adapter.id,
    displayName: adapter.displayName,
    executable: adapter.executable,
    status,
    capabilities,
    models,
    ...(modelsError === undefined ? {} : { modelsError }),
  };
}

export async function handleProviderCommandList(
  deps: ProviderCommandDeps,
  options: ProviderCommandListOptions,
): Promise<void> {
  const adapters = await getProviderCommandAdapters(deps);
  const inspections = await Promise.all(
    adapters.map((adapter) => inspectProviderCommand(adapter, true)),
  );
  if (options.json) {
    deps.stdout.write(`${JSON.stringify({ providers: inspections }, null, 2)}\n`);
    return;
  }
  if (inspections.length === 0) {
    deps.stdout.write(
      `No provider CLI commands configured. Set ${PROVIDER_CLI_CONFIG_ENV} to a JSON array.\n`,
    );
    return;
  }
  for (const inspection of inspections) {
    deps.stdout.write(
      `${inspection.id}  executable=${inspection.executable}  status=${inspection.status.code} ` +
        `version=${inspection.status.version ?? 'unknown'} models=${String(inspection.models.length)}\n`,
    );
    if (inspection.status.message !== undefined) {
      deps.stdout.write(`  error: ${inspection.status.message}\n`);
    }
    if (inspection.modelsError !== undefined) {
      deps.stdout.write(`  models: ${inspection.modelsError}\n`);
    }
  }
}

export async function handleProviderCommandDetect(
  deps: ProviderCommandDeps,
  providerId: string | undefined,
  options: ProviderCommandDetectOptions,
): Promise<void> {
  const adapters = await getProviderCommandAdapters(deps);
  const selected = selectAdapters(deps, adapters, providerId);
  if (selected.length === 0) {
    deps.stdout.write(
      `No provider CLI commands configured. Set ${PROVIDER_CLI_CONFIG_ENV} to a JSON array.\n`,
    );
    return;
  }
  const inspections = await Promise.all(
    selected.map((adapter) => inspectProviderCommand(adapter, false)),
  );
  if (options.json) {
    deps.stdout.write(`${JSON.stringify({ providers: inspections }, null, 2)}\n`);
    return;
  }
  for (const inspection of inspections) {
    deps.stdout.write(
      `${inspection.id}  executable=${inspection.executable}  status=${inspection.status.code} ` +
        `version=${inspection.status.version ?? 'unknown'}\n`,
    );
    if (inspection.status.message !== undefined) deps.stdout.write(`  error: ${inspection.status.message}\n`);
  }
}

export async function handleProviderCommandCapabilities(
  deps: ProviderCommandDeps,
  providerId: string | undefined,
  options: ProviderCommandDetectOptions,
): Promise<void> {
  const adapters = await getProviderCommandAdapters(deps);
  const selected = selectAdapters(deps, adapters, providerId);
  if (selected.length === 0) {
    deps.stdout.write(
      `No provider CLI commands configured. Set ${PROVIDER_CLI_CONFIG_ENV} to a JSON array.\n`,
    );
    return;
  }
  const inspections = await Promise.all(
    selected.map((adapter) => inspectProviderCommand(adapter, false)),
  );
  if (options.json) {
    deps.stdout.write(
      `${JSON.stringify(
        { providers: inspections.map(({ id, displayName, executable, capabilities }) => ({ id, displayName, executable, capabilities })) },
        null,
        2,
      )}\n`,
    );
    return;
  }
  for (const inspection of inspections) {
    const capabilities = inspection.capabilities;
    deps.stdout.write(`${inspection.id}  status=${capabilities.code}\n`);
    deps.stdout.write(
      `  streaming=${String(capabilities.streaming)} cancellation=${String(capabilities.cancellation)} ` +
        `model_selection=${String(capabilities.modelSelection)} model_listing=${String(capabilities.modelListing)} ` +
        `structured_output=${String(capabilities.structuredOutput)} usage=${String(capabilities.usageMetadata)}\n`,
    );
    if (capabilities.message !== undefined) deps.stdout.write(`  error: ${capabilities.message}\n`);
  }
}

export async function handleProviderCommandTest(
  deps: ProviderCommandDeps,
  providerId: string,
  options: ProviderCommandTestOptions,
): Promise<void> {
  const adapters = await getProviderCommandAdapters(deps);
  const adapter = selectAdapters(deps, adapters, providerId)[0];
  if (adapter === undefined) return;
  const status = await adapter.detect();
  if (!status.available) {
    deps.stderr.write(`Provider ${providerId} is unavailable: ${status.code}.\n`);
    deps.exit(1);
  }

  const request: ProviderRequest = {
    requestId: `cli-provider-test-${Date.now().toString(36)}`,
    prompt: options.prompt,
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  };
  const events: ProviderEvent[] = [];
  for await (const event of adapter.run(request)) {
    events.push(event);
    if (!options.json && event.kind === 'text') deps.stdout.write(event.text);
  }
  if (options.json) {
    deps.stdout.write(`${JSON.stringify({ providerId, events }, null, 2)}\n`);
    return;
  }
  deps.stdout.write('\nProvider test completed.\n');
  const usage = events.findLast((event) => event.kind === 'usage');
  if (usage?.kind === 'usage') deps.stdout.write(`Usage: ${JSON.stringify(usage.usage)}\n`);
}

function selectAdapters(
  deps: ProviderCommandDeps,
  adapters: readonly ProviderCommandAdapter[],
  providerId: string | undefined,
): readonly ProviderCommandAdapter[] {
  if (providerId === undefined) return adapters;
  const adapter = adapters.find((candidate) => candidate.id === providerId);
  if (adapter === undefined) {
    deps.stderr.write(`Provider CLI "${providerId}" is not configured.\n`);
    deps.exit(1);
  }
  return adapter === undefined ? [] : [adapter];
}

function providerCommandErrorCode(error: unknown): ProviderCommandErrorCode {
  return error instanceof ProviderCommandError ? error.code : 'nonzero_exit';
}

function getProviderCommandAdapters(
  deps: ProviderCommandDeps,
): Promise<readonly ProviderCommandAdapter[]> {
  return deps.getProviderCommandAdapters === undefined
    ? createConfiguredProviderCommandAdapters(deps.env)
    : deps.getProviderCommandAdapters();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
