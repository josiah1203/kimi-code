import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSpiderByteHarness } from '@spiderbyte/sdk';

import { smokeIdentityFromEnv } from './runtime-smoke-helpers';

async function main(): Promise<void> {
  const homeDir = await mkdtemp(join(tmpdir(), 'spiderbyte-harness-config-home-'));
  const harness = createSpiderByteHarness({ homeDir, identity: smokeIdentityFromEnv() });

  try {
    const initial = await harness.getConfig();
    if (Object.keys(initial.providers).length > 0) {
      throw new Error('expected empty providers for a fresh config home');
    }

    await harness.setConfig({
      defaultModel: 'local/example-model',
      thinking: { enabled: true },
      defaultPermissionMode: 'manual',
      defaultPlanMode: false,
      providers: {
        local: {
          type: 'local',
          baseUrl: 'http://127.0.0.1:8000/v1',
        },
      },
      models: {
        'local/example-model': {
          provider: 'local',
          model: 'example-model',
          maxContextSize: 32768,
          capabilities: ['thinking'],
          displayName: 'Local Example Model',
        },
      },
      loopControl: {
        maxRetriesPerStep: 3,
        maxRalphIterations: 0,
        reservedContextSize: 5000,
        compactionTriggerRatio: 0.85,
      },
    });

    const configPath = join(homeDir, 'config.toml');
    const text = await readFile(configPath, 'utf-8');
    for (const expected of [
      'default_model = "local/example-model"',
      'default_permission_mode = "manual"',
      '[providers.local]',
      '[models."local/example-model"]',
    ]) {
      if (!text.includes(expected)) {
        throw new Error(`missing ${expected} in written config`);
      }
    }

    const reloaded = await harness.getConfig({ reload: true });
    if (reloaded.defaultModel !== 'local/example-model') {
      throw new Error('reloaded config did not preserve defaultModel');
    }
    if (reloaded.providers.local?.type !== 'local') {
      throw new Error('reloaded config did not preserve the local provider');
    }

    process.stdout.write(`config: ${configPath}\n`);
    process.stdout.write('ok\n');
  } finally {
    await harness.close();
    await rm(homeDir, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
