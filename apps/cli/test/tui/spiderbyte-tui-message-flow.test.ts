import { describe, expect, it, vi } from 'vitest';

import { SpiderByteTUI, type SpiderByteTUIStartupInput } from '#/tui/spiderbyte-tui';

function startupInput(): SpiderByteTUIStartupInput {
  return {
    cliOptions: {
      session: undefined,
      continue: false,
      yolo: false,
      auto: false,
      plan: false,
      model: 'local',
      outputFormat: undefined,
      prompt: undefined,
      skillsDirs: [],
      agent: undefined,
      agentFiles: [],
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

function session() {
  return {
    id: 'session-local',
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
    prompt: vi.fn(async () => {}),
    compact: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

function makeHarness(sessionValue: ReturnType<typeof session>) {
  return {
    getConfig: vi.fn(async () => ({
      providers: { local: { type: 'openai-compatible', baseUrl: 'http://127.0.0.1:9000/v1' } },
      models: { local: { provider: 'local', model: 'example-local', maxContextSize: 8192 } },
      defaultModel: 'local',
    })),
    setConfig: vi.fn(async () => {}),
    replaceConfigSections: vi.fn(async () => {}),
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

async function makeDriver() {
  const sessionValue = session();
  const harness = makeHarness(sessionValue);
  const driver = new SpiderByteTUI(harness as never, startupInput()) as unknown as {
    state: SpiderByteTUI['state'];
    init(): Promise<boolean>;
    handleUserInput(text: string): void;
  };
  vi.spyOn(driver.state.ui, 'requestRender').mockImplementation(() => {});
  vi.spyOn(driver.state.terminal, 'setProgress').mockImplementation(() => {});
  await driver.init();
  return { driver, harness, session: sessionValue };
}

describe('SpiderByteTUI local message flow', () => {
  it('creates exactly one local session for the first prompt', async () => {
    const { driver, harness, session: sessionValue } = await makeDriver();

    expect(harness.createSession).not.toHaveBeenCalled();
    driver.handleUserInput('run the local smoke test');

    await vi.waitFor(() => expect(sessionValue.prompt).toHaveBeenCalledWith('run the local smoke test'));
    expect(harness.createSession).toHaveBeenCalledTimes(1);
    expect(harness.createSession).toHaveBeenCalledWith({
      workDir: '/tmp/spiderbyte-project',
      model: 'local',
      thinking: undefined,
      permission: 'manual',
      planMode: undefined,
    });
    expect(driver.state.appState.sessionId).toBe('session-local');
  });

  it('creates a session for a session-scoped command without hosted authentication', async () => {
    const { driver, harness, session: sessionValue } = await makeDriver();

    driver.handleUserInput('/compact');
    await vi.waitFor(() => expect(sessionValue.compact).toHaveBeenCalledWith({ instruction: undefined }));

    expect(harness.createSession).toHaveBeenCalledTimes(1);
    expect(harness).not.toHaveProperty('login');
    expect(harness).not.toHaveProperty('logout');
  });
});
