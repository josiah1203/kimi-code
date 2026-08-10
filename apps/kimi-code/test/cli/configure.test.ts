import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

import { registerConfigureCommand } from '#/cli/sub/configure';

const configureMocks = vi.hoisted(() => {
  const connection = { id: 'conn_local' };
  const session = {
    id: 'session_local',
    selectPlatformModel: vi.fn(async () => ({
      model_ref: { provider_connection_id: connection.id, model: 'smoke-model' },
      fallback_connection_ids: [],
    })),
  };
  const platform = {
    workspaceIdForRoot: vi.fn(async () => 'workspace_local'),
    connections: {
      create: vi.fn(async () => connection),
      createWithSecret: vi.fn(async () => connection),
      validate: vi.fn(async () => connection),
    },
  };
  const harness = {
    ensureConfigFile: vi.fn(async () => {}),
    createSession: vi.fn(async () => session),
    close: vi.fn(async () => {}),
    platform,
  };
  return { connection, session, platform, harness, createKimiHarnessV2: vi.fn(() => harness) };
});

vi.mock('@moonshot-ai/kimi-code-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@moonshot-ai/kimi-code-sdk')>();
  return {
    ...actual,
    createKimiHarnessV2: configureMocks.createKimiHarnessV2,
    resolveKimiHome: vi.fn(() => '/tmp/spyderbyte-configure-test'),
  };
});

describe('configure command', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    process.exitCode = 0;
  });

  it('accepts --model after the subcommand when the parent also owns --model', async () => {
    const program = new Command('spyderbyte').option('-m, --model <model>');
    registerConfigureCommand(program, '0.0.0-test');

    await program.parseAsync([
      'node',
      'spyderbyte',
      'configure',
      '--provider',
      'local',
      '--model',
      'smoke-model',
      '--no-credentials',
      '--skip-validation',
    ]);

    expect(configureMocks.platform.connections.create).toHaveBeenCalledWith(
      'workspace_local',
      expect.objectContaining({
        provider: 'local',
        secret_ref: 'secret_none',
        metadata: expect.objectContaining({ default_model: 'smoke-model' }),
      }),
    );
    expect(configureMocks.platform.connections.validate).not.toHaveBeenCalled();
    expect(configureMocks.session.selectPlatformModel).toHaveBeenCalledWith({
      model_ref: { provider_connection_id: 'conn_local', model: 'smoke-model' },
      fallback_connection_ids: [],
    });
    expect(stdoutWrite.mock.calls.map((call: readonly unknown[]) => String(call[0])).join('')).toContain(
      'Fresh `spyderbyte run` will use this canonical provider connection.',
    );
  });
});
