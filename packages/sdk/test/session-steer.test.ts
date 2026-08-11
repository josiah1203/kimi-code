import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSpiderByteHarness, type SpiderByteError } from '#/index';

import { makeTempDir, removeTempDirs, waitForAgentWireEvent } from './session-runtime-helpers';
import { TEST_IDENTITY } from './test-identity';
import { startOpenAITestServer, type OpenAITestServer } from './openai-test-server';

const tempDirs: string[] = [];
let provider: OpenAITestServer;

beforeEach(async () => {
  provider = await startOpenAITestServer({ responseText: () => 'steer response' });
});

afterEach(async () => {
  await provider.close();
  await removeTempDirs(tempDirs);
});

describe('Session.steer', () => {
  it('sends turn.steer to the core session runtime', async () => {
    const homeDir = await makeTempDir(tempDirs, 'spiderbyte-sdk-steer-home-');
    const workDir = await makeTempDir(tempDirs, 'spiderbyte-sdk-steer-work-');
    await writeFakeModelConfig(homeDir, provider.baseUrl);
    const harness = createSpiderByteHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_steer_wire', workDir });

      await session.steer('also do this');

      await expect(
        waitForAgentWireEvent(homeDir, session.id, 'turn.steer', (event) =>
          Array.isArray(event['input']),
        ),
      ).resolves.toMatchObject({
        type: 'turn.steer',
        input: [{ type: 'text', text: 'also do this' }],
      });
    } finally {
      await harness.close();
    }
  });

  it('rejects empty steer input', async () => {
    const homeDir = await makeTempDir(tempDirs, 'spiderbyte-sdk-steer-home-');
    const workDir = await makeTempDir(tempDirs, 'spiderbyte-sdk-steer-work-');
    const harness = createSpiderByteHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_steer_empty', workDir });

      await expect(session.steer('   ')).rejects.toMatchObject({
        name: 'SpiderByteError',
        code: 'request.prompt_input_empty',
      } satisfies Partial<SpiderByteError>);
    } finally {
      await harness.close();
    }
  });

  it('rejects after the session is closed', async () => {
    const homeDir = await makeTempDir(tempDirs, 'spiderbyte-sdk-steer-home-');
    const workDir = await makeTempDir(tempDirs, 'spiderbyte-sdk-steer-work-');
    const harness = createSpiderByteHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_steer_closed', workDir });
      await session.close();

      await expect(session.steer('hello')).rejects.toMatchObject({
        name: 'SpiderByteError',
        code: 'session.closed',
      } satisfies Partial<SpiderByteError>);
    } finally {
      await harness.close();
    }
  });
});

async function writeFakeModelConfig(homeDir: string, baseUrl: string): Promise<void> {
  await writeFile(
    join(homeDir, 'config.toml'),
    `
default_model = "fake-model"

[providers.local]
type = "openai"
base_url = "${baseUrl}"
api_key = "sk-test"

[models.fake-model]
provider = "local"
model = "fake-model"
max_context_size = 1000
`,
    'utf-8',
  );
}
