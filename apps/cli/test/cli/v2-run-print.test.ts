import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  IAgentGoalService,
  IAgentLifecycleService,
  IAgentPermissionModeService,
  IAgentProfileService,
  IAgentPromptService,
  IAgentTaskService,
  IAuthSummaryService,
  IBootstrapService,
  IConfigService,
  IEventBus,
  IFileSystemStorageService,
  IOAuthToolkit,
  ISessionCronService,
  ISessionIndex,
  ISessionLifecycleService,
  IWorkspaceLifecycleService,
  IPlatformModelBindingService,
  IWorkspaceProviderConnectionService,
  ITelemetryService,
  IFlagService,
  type BootstrapInput,
  type DomainEvent,
} from '@spiderbyte/agent-core';

import { runPrint } from '../../src/cli/run-print';

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  ensureMainAgent: vi.fn(),
  createSpiderByteDefaultHeaders: vi.fn(() => ({})),
  resolveSpiderByteHome: vi.fn((homeDir?: string) => homeDir ?? '/tmp/spiderbyte-test-home'),
  createSpiderByteDeviceId: vi.fn(() => 'device-1'),
}));

vi.mock('@spiderbyte/agent-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@spiderbyte/agent-core')>();
  return {
    ...actual,
    bootstrap: mocks.bootstrap,
    ensureMainAgent: mocks.ensureMainAgent,
  };
});

vi.mock('@spiderbyte/oauth', async () => {
  const actual = await vi.importActual<typeof import('@spiderbyte/oauth')>(
    '@spiderbyte/oauth',
  );
  return {
    ...actual,
    createSpiderByteDefaultHeaders: mocks.createSpiderByteDefaultHeaders,
    createSpiderByteDeviceId: mocks.createSpiderByteDeviceId,
  };
});

vi.mock('@spiderbyte/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@spiderbyte/sdk')>();
  return {
    ...actual,
    resolveSpiderByteHome: mocks.resolveSpiderByteHome,
  };
});

vi.mock('@spiderbyte/telemetry', () => ({
  initializeTelemetry: vi.fn(),
  setCrashPhase: vi.fn(),
  shutdownTelemetry: vi.fn(),
  track: vi.fn(),
  setTelemetryContext: vi.fn(),
  withTelemetryContext: vi.fn(() => ({ track: vi.fn() })),
}));

interface FakeScope {
  readonly id: string;
  readonly accessor: { readonly get: (token: unknown) => unknown };
  readonly dispose: ReturnType<typeof vi.fn>;
}

function fakeScope(id: string, services: Map<unknown, unknown>): FakeScope {
  return {
    id,
    accessor: {
      get: (token: unknown) => {
        if (!services.has(token)) throw new Error(`unexpected service request: ${String(token)}`);
        return services.get(token);
      },
    },
    dispose: vi.fn(),
  };
}

function writer() {
  let text = '';
  return {
    write: vi.fn((chunk: string) => {
      text += chunk;
      return true;
    }),
    text: () => text,
  };
}

function opts(overrides: Record<string, unknown> = {}) {
  return {
    session: undefined,
    continue: false,
    yolo: false,
    auto: false,
    plan: false,
    model: undefined,
    outputFormat: undefined,
    prompt: 'say hello',
    skillsDirs: [],
    agent: undefined,
    agentFiles: [],
    addDirs: [],
    ...overrides,
  } as const;
}

interface FakeCanonicalConnection {
  readonly id: string;
  readonly state: 'active' | 'validated' | 'configured';
  readonly updated_at: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

function makeFakeHarness(options: {
  readonly defaultModel?: string;
  readonly canonicalConnection?: FakeCanonicalConnection;
} = {}) {
  // Native event listeners registered on the main agent's IEventBus; the turn
  // emits a streaming assistant delta before completing.
  const eventListeners = new Set<(event: DomainEvent) => void>();
  const profileState: { profileName: string | undefined } = { profileName: undefined };

  const agentServices = new Map<unknown, unknown>([
    [
      IAgentProfileService,
      {
        bind: vi.fn(async () => {}),
        setModel: vi.fn(async () => ({ model: 'k2' })),
        getModel: () => 'k2',
        data: () => ({ profileName: profileState.profileName }),
      },
    ],
    [IAgentPermissionModeService, { mode: 'auto', setMode: vi.fn() }],
    [IAuthSummaryService, { ensureReady: vi.fn(async () => {}) }],
    [
      IEventBus,
      {
        subscribe: vi.fn((handler: (event: DomainEvent) => void) => {
          eventListeners.add(handler);
          return { dispose: () => eventListeners.delete(handler) };
        }),
      },
    ],
    [
      IAgentPromptService,
      {
        enqueue: vi.fn(async () => {
          // Emit a native assistant delta on the main agent bus, then complete.
          for (const listener of [...eventListeners]) {
            listener({ type: 'assistant.delta', turnId: 1, delta: 'hello world' } as DomainEvent);
          }
          return {
            launched: Promise.resolve({
              id: 1,
              result: Promise.resolve({ type: 'completed' }),
            }),
          };
        }),
      },
    ],
    [IAgentTaskService, { list: vi.fn(() => []) }],
    [IAgentGoalService, { createGoal: vi.fn(), getGoal: vi.fn() }],
  ]);
  const agent = fakeScope('main', agentServices);

  const platformBinding = {
    select: vi.fn(async (input: { readonly connection_id: string; readonly model?: string }) => ({
      model_alias: `platform:${input.connection_id}/${input.model}`,
    })),
  };
  if (options.canonicalConnection !== undefined) {
    agentServices.set(IPlatformModelBindingService, platformBinding);
  }

  const sessionServices = new Map<unknown, unknown>([
    // drain enumerates agents; empty → no background work to wait on.
    [IAgentLifecycleService, { list: vi.fn(() => []) }],
    // No scheduled cron tasks → no future fire time to wait on.
    [ISessionCronService, { getNextFireTime: vi.fn(() => null) }],
  ]);
  const session = fakeScope('ses_v2', sessionServices);

  const handlerServices = new Map<unknown, unknown>([
    [
      ISessionLifecycleService,
      {
        create: vi.fn(async () => session),
        resume: vi.fn(async () => session),
      },
    ],
  ]);
  if (options.canonicalConnection !== undefined) {
    handlerServices.set(IWorkspaceProviderConnectionService, {
      list: vi.fn(async () => [options.canonicalConnection]),
    });
  }
  const workspace = fakeScope('wd_v2', handlerServices);

  const appServices = new Map<unknown, unknown>([
    [
      IFlagService,
      {
        explain: vi.fn(() => ({
          id: 'platform_services',
          title: 'Platform services',
          description: 'Canonical local platform services',
          surface: 'platform',
          env: 'SPIDERBYTE_EXPERIMENTAL_PLATFORM_SERVICES',
          defaultEnabled: true,
          enabled: true,
          source: 'default',
        })),
      },
    ],
    [
      IConfigService,
      {
        ready: Promise.resolve(),
        get: vi.fn((section: string) =>
          section === 'defaultModel'
            ? ('defaultModel' in options ? options.defaultModel : 'k2')
            : undefined,
        ),
        // `applyPrintModeConfigDefaults` inspects each section and fills unset
        // keys via the memory layer; an empty section means everything is unset.
        inspect: vi.fn(() => ({ value: {} })),
        set: vi.fn(async () => {}),
        diagnostics: vi.fn(() => []),
      },
    ],
    [
      IWorkspaceLifecycleService,
      {
        handlerFor: vi.fn(async () => workspace),
      },
    ],
    [
      ISessionIndex,
      {
        list: vi.fn(async () => ({ items: [] })),
        get: vi.fn(async (id: string) => ({
          id,
          workspaceId: 'wd_v2',
          cwd: process.cwd(),
          createdAt: 1,
          updatedAt: 1,
          archived: false,
        })),
      },
    ],
    [ISessionIndex, { get: vi.fn(async () => undefined), listRecent: vi.fn(async () => ({ items: [] })) }],
    [
      IBootstrapService,
      {
        platform: 'linux',
        arch: 'x64',
        clientIdentity: {
          productName: 'test-product',
          version: '1.2.3-test',
          platform: 'test_platform',
        },
        osHomeDir: '/home/test',
        getEnv: () => undefined,
      },
    ],
    [IOAuthToolkit, { getCachedAccessToken: vi.fn(async () => undefined) }],
    [IFileSystemStorageService, {}],
    [
      ITelemetryService,
      (() => {
        const svc = {
          setAppender: vi.fn(),
          setContext: vi.fn(),
          track: vi.fn(),
          track2: vi.fn(),
          shutdown: vi.fn(async () => {}),
          withContext: vi.fn(() => svc),
        };
        return svc;
      })(),
    ],
  ]);
  const app = fakeScope('app', appServices);
  return {
    app,
    agent,
    session,
    agentServices,
    appServices,
    handlerServices,
    profileState,
    platformBinding,
  };
}

describe('runPrint', () => {
  beforeEach(() => {
    vi.stubEnv('SPIDERBYTE_EXPERIMENTAL_FLAG', '1');
    vi.stubEnv('SPIDERBYTE_MODEL_OUTPUT_FORMAT', '');
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('submits a prompt, renders native events, awaits completion, and drains', async () => {
    const stdout = writer();
    const stderr = writer();
    const { app, agent, agentServices } = makeFakeHarness();

    mocks.bootstrap.mockReturnValue({ app });
    mocks.ensureMainAgent.mockResolvedValue(agent);

    await runPrint(opts() as never, '1.2.3-test', { stdout, stderr });

    const promptService = agentServices.get(IAgentPromptService) as { enqueue: ReturnType<typeof vi.fn> };
    expect(promptService.enqueue).toHaveBeenCalledWith({
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'say hello' }],
        toolCalls: [],
        origin: { kind: 'user' },
      },
    });
    // Version banner is first, then the rendered assistant output.
    expect(stderr.write).toHaveBeenNthCalledWith(1, 'spyderbyte version 1.2.3-test\n');
    expect(stdout.text()).toContain('hello world');
    expect(app.dispose).toHaveBeenCalled();
  });

  it('passes explicit skill dirs from --skillsDir into bootstrap args', async () => {
    const stdout = writer();
    const stderr = writer();
    const { app, agent } = makeFakeHarness();

    mocks.bootstrap.mockReturnValue({ app });
    mocks.ensureMainAgent.mockResolvedValue(agent);

    await runPrint(opts({ skillsDirs: ['/skills'] }) as never, '1.2.3-test', {
      stdout,
      stderr,
    });

    const input = mocks.bootstrap.mock.calls[0]?.[0] as BootstrapInput;
    expect(input.args?.skillDirs).toEqual(['/skills']);
  });

  it('leaves the skill dirs arg unset when --skillsDir is empty', async () => {
    const stdout = writer();
    const stderr = writer();
    const { app, agent } = makeFakeHarness();

    mocks.bootstrap.mockReturnValue({ app });
    mocks.ensureMainAgent.mockResolvedValue(agent);

    await runPrint(opts() as never, '1.2.3-test', { stdout, stderr });

    const input = mocks.bootstrap.mock.calls[0]?.[0] as BootstrapInput;
    expect(input.args?.skillDirs ?? []).toEqual([]);
  });

  it('seeds explicit agent files from --agentFile and binds the --agent profile', async () => {
    const stdout = writer();
    const stderr = writer();
    const { app, agent, appServices, agentServices, handlerServices } = makeFakeHarness();

    mocks.bootstrap.mockReturnValue({ app });
    mocks.ensureMainAgent.mockResolvedValue(agent);

    await runPrint(
      opts({ agent: 'reviewer', agentFiles: ['/agents/reviewer.md'] }) as never,
      '1.2.3-test',
      { stdout, stderr },
    );

    const input = mocks.bootstrap.mock.calls[0]?.[0] as BootstrapInput;
    expect(input.args?.agentFiles).toEqual(['/agents/reviewer.md']);

    const lifecycle = handlerServices.get(ISessionLifecycleService) as {
      create: ReturnType<typeof vi.fn>;
    };
    expect(lifecycle.create).toHaveBeenCalledWith({
      workDir: process.cwd(),
      additionalDirs: undefined,
      mainAgentBinding: { profile: 'reviewer', model: 'k2' },
    });
    const profile = agentServices.get(IAgentProfileService) as { bind: ReturnType<typeof vi.fn> };
    expect(profile.bind).not.toHaveBeenCalled();
  });

  it('binds the profile named by --agent-file when --agent is absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spiderbyte-agent-file-'));
    const agentFile = join(dir, 'reviewer.md');
    await writeFile(
      agentFile,
      '---\nname: file-reviewer\ndescription: Reviews code.\n---\n\nYou review code.\n',
    );
    const stdout = writer();
    const stderr = writer();
    const { app, agent, appServices, agentServices, handlerServices } = makeFakeHarness();

    mocks.bootstrap.mockReturnValue({ app });
    mocks.ensureMainAgent.mockResolvedValue(agent);

    await runPrint(opts({ agentFiles: [agentFile] }) as never, '1.2.3-test', {
      stdout,
      stderr,
    });

    const input = mocks.bootstrap.mock.calls[0]?.[0] as BootstrapInput;
    expect(input.args?.agentFiles).toEqual([agentFile]);

    const lifecycle = handlerServices.get(ISessionLifecycleService) as {
      create: ReturnType<typeof vi.fn>;
    };
    expect(lifecycle.create).toHaveBeenCalledWith({
      workDir: process.cwd(),
      additionalDirs: undefined,
      mainAgentBinding: { profile: 'file-reviewer', model: 'k2' },
    });
    const profile = agentServices.get(IAgentProfileService) as { bind: ReturnType<typeof vi.fn> };
    expect(profile.bind).not.toHaveBeenCalled();
  });

  it('does not materialize a main agent after fresh profile binding fails', async () => {
    const stdout = writer();
    const stderr = writer();
    const { app, handlerServices } = makeFakeHarness();
    const lifecycle = handlerServices.get(ISessionLifecycleService) as {
      create: ReturnType<typeof vi.fn>;
    };
    lifecycle.create.mockRejectedValueOnce(new Error('Unknown agent profile'));
    mocks.bootstrap.mockReturnValue({ app });

    await expect(
      runPrint(opts({ agent: 'missing' }) as never, '1.2.3-test', { stdout, stderr }),
    ).rejects.toThrow('Unknown agent profile');

    expect(mocks.ensureMainAgent).not.toHaveBeenCalled();
  });

  it('fails before any turn when --agent-file is invalid', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spiderbyte-agent-file-'));
    const agentFile = join(dir, 'broken.md');
    await writeFile(agentFile, '---\nname: broken\n---\n\nbody\n');
    const stdout = writer();
    const stderr = writer();
    const { app, agent, agentServices } = makeFakeHarness();

    mocks.bootstrap.mockReturnValue({ app });
    mocks.ensureMainAgent.mockResolvedValue(agent);

    await expect(
      runPrint(opts({ agentFiles: [agentFile] }) as never, '1.2.3-test', { stdout, stderr }),
    ).rejects.toThrow(/Invalid agent file/);

    const profile = agentServices.get(IAgentProfileService) as {
      bind: ReturnType<typeof vi.fn>;
    };
    expect(profile.bind).not.toHaveBeenCalled();
  });

  it('leaves the agent files arg unset when --agentFile is empty', async () => {
    const stdout = writer();
    const stderr = writer();
    const { app, agent } = makeFakeHarness();

    mocks.bootstrap.mockReturnValue({ app });
    mocks.ensureMainAgent.mockResolvedValue(agent);

    await runPrint(opts() as never, '1.2.3-test', { stdout, stderr });

    const input = mocks.bootstrap.mock.calls[0]?.[0] as BootstrapInput;
    expect(input.args?.agentFiles ?? []).toEqual([]);
  });

  it('passes --agent-file paths through unresolved so the engine can expand ~', async () => {
    const stdout = writer();
    const stderr = writer();
    const { app, agent } = makeFakeHarness();

    mocks.bootstrap.mockReturnValue({ app });
    mocks.ensureMainAgent.mockResolvedValue(agent);

    await runPrint(
      opts({ agent: 'reviewer', agentFiles: ['~/agents/reviewer.md'] }) as never,
      '1.2.3-test',
      { stdout, stderr },
    );

    const input = mocks.bootstrap.mock.calls[0]?.[0] as BootstrapInput;
    expect(input.args?.agentFiles).toEqual(['~/agents/reviewer.md']);
  });

  it('treats re-selecting the already-bound profile on resume as a no-op', async () => {
    const stdout = writer();
    const stderr = writer();
    const { app, agent, agentServices, appServices, profileState } = makeFakeHarness();
    profileState.profileName = 'reviewer';

    const index = appServices.get(ISessionIndex) as { get: ReturnType<typeof vi.fn> };
    index.get.mockResolvedValue({ id: 'ses_1', cwd: process.cwd() });

    mocks.bootstrap.mockReturnValue({ app });
    mocks.ensureMainAgent.mockResolvedValue(agent);

    await runPrint(opts({ session: 'ses_1', agent: 'reviewer' }) as never, '1.2.3-test', {
      stdout,
      stderr,
    });

    const profile = agentServices.get(IAgentProfileService) as {
      bind: ReturnType<typeof vi.fn>;
      setModel: ReturnType<typeof vi.fn>;
    };
    expect(profile.bind).not.toHaveBeenCalled();
    expect(profile.setModel).not.toHaveBeenCalled();
  });

  it('switches the model when resuming with the already-bound profile and an explicit model', async () => {
    const stdout = writer();
    const stderr = writer();
    const { app, agent, agentServices, appServices, profileState } = makeFakeHarness();
    profileState.profileName = 'reviewer';

    const index = appServices.get(ISessionIndex) as { get: ReturnType<typeof vi.fn> };
    index.get.mockResolvedValue({ id: 'ses_1', cwd: process.cwd() });

    mocks.bootstrap.mockReturnValue({ app });
    mocks.ensureMainAgent.mockResolvedValue(agent);

    await runPrint(
      opts({ session: 'ses_1', agent: 'reviewer', model: 'new-model' }) as never,
      '1.2.3-test',
      { stdout, stderr },
    );

    const profile = agentServices.get(IAgentProfileService) as {
      bind: ReturnType<typeof vi.fn>;
      setModel: ReturnType<typeof vi.fn>;
    };
    expect(profile.bind).not.toHaveBeenCalled();
    expect(profile.setModel).toHaveBeenCalledWith('new-model');
  });

  it('auto-selects the persisted canonical provider for a fresh platform session', async () => {
    const stdout = writer();
    const stderr = writer();
    const canonicalConnection: FakeCanonicalConnection = {
      id: 'conn_openai',
      state: 'validated',
      updated_at: '2026-08-10T00:00:00.000Z',
      metadata: { default_model: 'gpt-5-mini' },
    };
    const { app, agent, handlerServices, appServices, platformBinding } = makeFakeHarness({
      defaultModel: undefined,
      canonicalConnection,
    });

    mocks.bootstrap.mockReturnValue({ app });
    mocks.ensureMainAgent.mockResolvedValue(agent);

    await runPrint(opts() as never, '1.2.3-test', { stdout, stderr });

    const lifecycle = handlerServices.get(ISessionLifecycleService) as {
      create: ReturnType<typeof vi.fn>;
    };
    expect(lifecycle.create).toHaveBeenCalledWith({
      workDir: process.cwd(),
      additionalDirs: undefined,
      mainAgentBinding: undefined,
    });
    expect(platformBinding.select).toHaveBeenCalledWith({
      connection_id: 'conn_openai',
      model: 'gpt-5-mini',
      fallback_connection_ids: [],
    });
    const telemetry = appServices.get(ITelemetryService) as { setContext: ReturnType<typeof vi.fn> };
    expect(telemetry.setContext).toHaveBeenCalledWith({
      sessionId: 'ses_v2',
      model: 'platform:conn_openai/gpt-5-mini',
    });
  });
});
