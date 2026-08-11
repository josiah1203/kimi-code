import { describe, expect, it, vi } from 'vitest';

import { SpiderByteTUI, type SpiderByteTUIStartupInput } from '#/tui/spiderbyte-tui';

function startupInput(
  overrides: Partial<SpiderByteTUIStartupInput['cliOptions']> = {},
): SpiderByteTUIStartupInput {
  return {
    cliOptions: {
      session: undefined,
      continue: false,
      yolo: false,
      auto: false,
      plan: false,
      model: undefined,
      outputFormat: undefined,
      prompt: undefined,
      skillsDirs: [],
      agent: undefined,
      agentFiles: [],
      ...overrides,
    },
    tuiConfig: {
      theme: 'dark',
      disablePasteBurst: false,
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' },
      upgrade: { autoInstall: true },
      statusLine: { items: null, command: null },
    },
    version: '0.0.0-test',
    workDir: '/tmp/spiderbyte-project',
  };
}

function session(id = 'session-local') {
  return {
    id,
    model: 'local',
    summary: { title: null, additionalDirs: [] },
    getStatus: vi.fn(async () => ({
      model: 'local',
      thinkingEffort: 'off',
      permission: 'manual',
      planMode: false,
      contextTokens: 0,
      maxContextTokens: 8192,
      contextUsage: 0,
      swarmMode: false,
    })),
    getGoal: vi.fn(async () => ({ goal: null })),
    getSessionWarnings: vi.fn(async () => []),
    setApprovalHandler: vi.fn(),
    setQuestionHandler: vi.fn(),
    setPermission: vi.fn(async () => {}),
    setPlanMode: vi.fn(async () => {}),
    setModel: vi.fn(async () => {}),
    setThinking: vi.fn(async () => {}),
    onEvent: vi.fn(() => () => {}),
    listSkills: vi.fn(async () => []),
    listPluginCommands: vi.fn(async () => []),
    listMcpServers: vi.fn(async () => []),
    close: vi.fn(async () => {}),
    prompt: vi.fn(async () => {}),
  };
}

function harness(sessionValue: ReturnType<typeof session>) {
  const config = {
    providers: { local: { type: 'openai-compatible', baseUrl: 'http://127.0.0.1:9000/v1' } },
    models: { local: { provider: 'local', model: 'example-local', maxContextSize: 8192 } },
    defaultModel: 'local',
  };
  return {
    getConfig: vi.fn(async () => config),
    createSession: vi.fn(async () => sessionValue),
    resumeSession: vi.fn(async () => sessionValue),
    listSessions: vi.fn(async () => []),
    listWorkspaceSkills: vi.fn(async () => []),
    listPluginCommands: vi.fn(async () => []),
    getExperimentalFeatures: vi.fn(async () => []),
    setTelemetryContext: vi.fn(),
    track: vi.fn(),
    withInteractiveAgent: vi.fn((_agentId: string, fn: () => unknown) => fn()),
    interactiveAgentId: 'main',
    close: vi.fn(async () => {}),
  };
}

function driverFor(
  harnessValue: ReturnType<typeof harness>,
  input = startupInput(),
): {
  state: SpiderByteTUI['state'];
  init(): Promise<boolean>;
} {
  const driver = new SpiderByteTUI(harnessValue as never, input) as unknown as {
    state: SpiderByteTUI['state'];
    init(): Promise<boolean>;
  };
  vi.spyOn(driver.state.ui, 'requestRender').mockImplementation(() => {});
  vi.spyOn(driver.state.terminal, 'setProgress').mockImplementation(() => {});
  return driver;
}

describe('SpiderByteTUI startup', () => {
  it('starts accountless and carries local provider defaults without creating a session', async () => {
    const sessionValue = session();
    const harnessValue = harness(sessionValue);
    const driver = driverFor(harnessValue, startupInput({ yolo: true }));

    await expect(driver.init()).resolves.toBe(false);

    expect(harnessValue.createSession).not.toHaveBeenCalled();
    expect(driver.state.startupState).toBe('ready');
    expect(driver.state.appState).toMatchObject({
      sessionId: '',
      model: 'local',
      permissionMode: 'yolo',
      maxContextTokens: 8192,
    });
  });

  it('renders the sessionless notice until the first local run is requested', async () => {
    const harnessValue = harness(session());
    const driver = driverFor(harnessValue);

    await driver.init();
    const finishStartup = driver as unknown as {
      finishStartup(shouldReplayHistory: boolean): Promise<void>;
    };
    await finishStartup.finishStartup(false);

    expect(driver.state.transcriptContainer.render(160).join('\n')).toContain(
      'No session yet — one will be created on your first message.',
    );
  });

  it('resumes an explicitly selected local session through the canonical runtime', async () => {
    const sessionValue = session('session-resume');
    const harnessValue = harness(sessionValue);
    harnessValue.listSessions.mockResolvedValue([
      { id: 'session-resume', workDir: '/tmp/spiderbyte-project' } as never,
    ]);
    const driver = driverFor(harnessValue, startupInput({ session: 'session-resume' }));

    await expect(driver.init()).resolves.toBe(true);

    expect(harnessValue.resumeSession).toHaveBeenCalledWith({
      id: 'session-resume',
      additionalDirs: undefined,
      replayTurnLimit: expect.any(Number),
    });
    expect(harnessValue.createSession).not.toHaveBeenCalled();
    expect(driver.state.appState.sessionId).toBe('session-resume');
  });
});
