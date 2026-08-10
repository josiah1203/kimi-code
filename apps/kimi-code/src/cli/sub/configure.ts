import type { Command } from 'commander';

import {
  createKimiHarnessV2,
  PLATFORM_NO_CREDENTIAL_SECRET_REF,
  resolveKimiHome,
  type KimiHarness,
  type ProviderConnectionProvider,
} from '@moonshot-ai/kimi-code-sdk';

import { createKimiCodeHostIdentity } from '#/cli/version';

interface ConfigureOptions {
  readonly provider: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly apiKeyEnv: string;
  /** Commander exposes `--no-credentials` as the negated `credentials` value. */
  readonly credentials?: boolean;
  readonly skipValidation?: boolean;
  readonly project?: string;
}

interface ConfigureCommandOptions extends Omit<ConfigureOptions, 'model'> {
  /** Commander may parse `--model` as the root option because the parent CLI also owns it. */
  readonly model?: string;
}

interface WritableLike {
  write(chunk: string): boolean;
}

/**
 * Configure one canonical ProviderConnection without putting a secret in
 * argv, stdout, transcripts, or durable platform projections. The key is
 * read only from the named environment variable and handed to the harness's
 * SecretStore boundary.
 */
export function registerConfigureCommand(parent: Command, version: string): void {
  const configure = parent
    .command('configure')
    .description('Configure a canonical SpiderByte provider connection and model.')
    .requiredOption('--provider <provider>', 'Provider id, for example openrouter, openai, anthropic, google, or local.')
    .option('--model <model>', 'Provider model name.')
    .option('--base-url <url>', 'Override the endpoint for OpenRouter, OpenAI-compatible, local, or custom providers.')
    .option('--api-key-env <name>', 'Environment variable containing the provider secret.', 'SPYDERBYTE_PROVIDER_API_KEY')
    .option('--no-credentials', 'Create an unauthenticated connection, for local endpoints.')
    .option('--skip-validation', 'Persist the connection without a live validation request.')
    .option('--project <project-id>', 'Bind the new connection to a SpiderByte Project.');

  configure.action(async (options: ConfigureCommandOptions, command: Command) => {
    try {
      const model = options.model ?? readParentModel(command);
      if (model === undefined) throw new Error("missing required option '--model <model>'");
      await handleConfigureCommand({ ...options, model }, version, process.stdout, process.env);
    } catch (error) {
      process.stderr.write(`SpiderByte configure failed: ${errorMessage(error)}\n`);
      process.exitCode = 1;
    }
  });
}

function readParentModel(command: Command): string | undefined {
  const model = command.parent?.opts<Record<string, unknown>>()['model'];
  return typeof model === 'string' && model.trim().length > 0 ? model : undefined;
}

export async function handleConfigureCommand(
  options: ConfigureOptions,
  version: string,
  stdout: WritableLike,
  env: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  const provider = parseProvider(options.provider);
  const model = options.model.trim();
  if (provider.length === 0 || model.length === 0) {
    throw new Error('--provider and --model cannot be empty');
  }

  const harness = createKimiHarnessV2({
    homeDir: resolveKimiHome(),
    identity: createKimiCodeHostIdentity(version),
    uiMode: 'configure',
  });
  try {
    await harness.ensureConfigFile();
    const platform = requirePlatform(harness);
    const session = await harness.createSession({ workDir: process.cwd() });
    const workspaceId = await platform.workspaceIdForRoot?.(process.cwd());
    if (workspaceId === undefined) {
      throw new Error('workspace registration did not produce a workspace id');
    }

    // Commander negated options default to true and become false when the
    // user explicitly passes `--no-credentials`.
    const unauthenticated = options.credentials === false;
    const secret = unauthenticated
      ? undefined
      : env[options.apiKeyEnv];
    if (secret === undefined && !unauthenticated && provider !== 'local') {
      throw new Error(
        `missing provider credential; set ${options.apiKeyEnv} or pass --no-credentials for an unauthenticated local endpoint`,
      );
    }

    const metadata = {
      default_model: model,
      models: [model],
      base_url: options.baseUrl,
    };
    const requestId = `cli:configure:${Date.now().toString(36)}`;
    const connection = secret === undefined
      ? await platform.connections.create(workspaceId, {
        request_id: `${requestId}:create`,
        name: `${provider} connection`,
        provider,
        scope: 'workspace',
        secret_ref: PLATFORM_NO_CREDENTIAL_SECRET_REF,
        capabilities: ['chat', 'tool_use'],
        metadata,
      })
      : await platform.connections.createWithSecret(workspaceId, {
        request_id: `${requestId}:create`,
        name: `${provider} connection`,
        provider,
        scope: 'workspace',
        secret,
        capabilities: ['chat', 'tool_use'],
        metadata,
      });

    if (options.project !== undefined) {
      await platform.governance.bindProjectResource({
        request_id: `${requestId}:project-binding`,
        actor_id: 'local-user',
        project_id: options.project,
        workspace_id: workspaceId,
        kind: 'llm_connection',
        resource_id: connection.id,
        role: 'default',
      });
    }

    const validated = options.skipValidation === true
      ? connection
      : await platform.connections.validate(workspaceId, connection.id, {
        request_id: `${requestId}:validate`,
      });
    if (validated === undefined) {
      throw new Error('connection was stored but provider validation did not succeed');
    }

    const selection = await session.selectPlatformModel({
      model_ref: { provider_connection_id: connection.id, model },
      fallback_connection_ids: [],
    });
    stdout.write(`SpiderByte provider configured: ${provider} · ${model}\n`);
    stdout.write(`Connection: ${connection.id}\n`);
    stdout.write(`Session: ${session.id}\n`);
    stdout.write(`Resume with: spyderbyte -r ${session.id}\n`);
    stdout.write('Fresh `spyderbyte run` will use this canonical provider connection.\n');
    stdout.write(`Platform model: ${selection.model_ref.provider_connection_id}/${selection.model_ref.model}\n`);
  } finally {
    await harness.close();
  }
}

function requirePlatform(harness: KimiHarness): NonNullable<KimiHarness['platform']> {
  if (harness.platform === undefined) {
    throw new Error(
      'canonical platform services are unavailable; do not silently fall back to legacy provider configuration',
    );
  }
  return harness.platform;
}

function parseProvider(value: string): ProviderConnectionProvider {
  const normalized = value.trim();
  const providers: readonly ProviderConnectionProvider[] = [
    'kimi',
    'openai',
    'anthropic',
    'google',
    'openrouter',
    'openai-compatible',
    'local',
    'custom',
  ];
  if (!providers.includes(normalized as ProviderConnectionProvider)) {
    throw new Error(`unsupported provider '${normalized}'`);
  }
  return normalized as ProviderConnectionProvider;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
