import { join } from 'node:path';

import { FileTokenStorage, type TokenInfo } from '@spiderbyte/oauth';
import { afterEach, describe, expect, it } from 'vitest';

import { createSpiderByteHarness, type SpiderByteError, type SpiderByteHarness } from '#/index';
import { makeTempDir, removeTempDirs, waitForAgentWireEvent } from './session-runtime-helpers';
import { TEST_IDENTITY } from './test-identity';

const tempDirs: string[] = [];

function freshToken(): TokenInfo {
  return {
    accessToken: 'oauth-access-token',
    refreshToken: 'oauth-refresh-token',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    scope: '',
    tokenType: 'Bearer',
    expiresIn: 3600,
  };
}

afterEach(async () => {
  await removeTempDirs(tempDirs);
});

describe('Session.setModel', () => {
  it('updates the runtime model and sends config.update with the resolved model', async () => {
    const homeDir = await makeTempDir(tempDirs, 'spiderbyte-sdk-model-home-');
    const workDir = await makeTempDir(tempDirs, 'spiderbyte-sdk-model-work-');
    const harness = createSpiderByteHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      await configureLocalProvider(harness);
      const session = await harness.createSession({
        id: 'ses_model_wire',
        workDir,
        model: 'initial-model',
      });

      await session.setModel('next-model');

      await expect(session.getStatus()).resolves.toMatchObject({ model: 'next-model' });
      const configEvent = await waitForAgentWireEvent(
        homeDir,
        session.id,
        'config.update',
        (event) => event['modelAlias'] === 'next-model',
      );
      expect(configEvent).toMatchObject({
        type: 'config.update',
        modelAlias: 'next-model',
      });
      expect(configEvent).not.toHaveProperty('provider');
    } finally {
      await harness.close();
    }
  });

  it('resolves managed OAuth aliases before updating the runtime provider', async () => {
    const homeDir = await makeTempDir(tempDirs, 'spiderbyte-sdk-model-home-');
    const workDir = await makeTempDir(tempDirs, 'spiderbyte-sdk-model-work-');
    await new FileTokenStorage(join(homeDir, 'credentials')).save('spiderbyte', freshToken());
    const harness = createSpiderByteHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      await harness.setConfig({
        providers: {
          'managed:spiderbyte': {
            type: 'kimi',
            baseUrl: 'https://api.kimi.com/coding/v1',
            apiKey: '',
            oauth: { storage: 'file', key: 'oauth/spiderbyte' },
          },
        },
        models: {
          'spiderbyte/initial': {
            provider: 'managed:spiderbyte',
            model: 'kimi-initial',
            maxContextSize: 262144,
          },
          'spiderbyte/kimi-for-coding': {
            provider: 'managed:spiderbyte',
            model: 'kimi-for-coding',
            maxContextSize: 262144,
          },
        },
        defaultModel: 'spiderbyte/initial',
      });
      const session = await harness.createSession({
        id: 'ses_model_oauth_wire',
        workDir,
        model: 'spiderbyte/initial',
      });

      await session.setModel('spiderbyte/kimi-for-coding');

      await expect(session.getStatus()).resolves.toMatchObject({
        model: 'spiderbyte/kimi-for-coding',
      });
      const configEvent = await waitForAgentWireEvent(
        homeDir,
        session.id,
        'config.update',
        (event) => event['modelAlias'] === 'spiderbyte/kimi-for-coding',
      );
      expect(configEvent).toMatchObject({
        type: 'config.update',
        modelAlias: 'spiderbyte/kimi-for-coding',
      });
      expect(configEvent).not.toHaveProperty('provider');
    } finally {
      await harness.close();
    }
  });

  it('rejects empty model names', async () => {
    const homeDir = await makeTempDir(tempDirs, 'spiderbyte-sdk-model-home-');
    const workDir = await makeTempDir(tempDirs, 'spiderbyte-sdk-model-work-');
    const harness = createSpiderByteHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      await configureLocalProvider(harness);
      const session = await harness.createSession({ id: 'ses_model_empty', workDir });

      await expect(session.setModel('   ')).rejects.toMatchObject({
        name: 'SpiderByteError',
        code: 'session.model_empty',
      } satisfies Partial<SpiderByteError>);
    } finally {
      await harness.close();
    }
  });

  it('rejects after the session is closed', async () => {
    const homeDir = await makeTempDir(tempDirs, 'spiderbyte-sdk-model-home-');
    const workDir = await makeTempDir(tempDirs, 'spiderbyte-sdk-model-work-');
    const harness = createSpiderByteHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      await configureLocalProvider(harness);
      const session = await harness.createSession({ id: 'ses_model_closed', workDir });
      await session.close();

      await expect(session.setModel('next-model')).rejects.toMatchObject({
        name: 'SpiderByteError',
        code: 'session.closed',
      } satisfies Partial<SpiderByteError>);
    } finally {
      await harness.close();
    }
  });
});

async function configureLocalProvider(harness: SpiderByteHarness): Promise<void> {
  await harness.setConfig({
    providers: {
      local: {
        type: 'kimi',
        apiKey: 'sk-test',
      },
    },
    models: {
      'initial-model': {
        provider: 'local',
        model: 'initial-model',
        maxContextSize: 262144,
      },
      'next-model': {
        provider: 'local',
        model: 'next-model',
        maxContextSize: 262144,
      },
    },
    defaultProvider: 'local',
  });
}
