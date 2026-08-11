import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSpiderByteHarness } from '@spiderbyte/sdk';

import { smokeIdentityFromEnv } from './runtime-smoke-helpers';

/**
 * Accountless authentication smoke test.
 *
 * Open Core never contacts a hosted SpiderByte identity service. This example
 * verifies the stable local auth projection and can optionally inspect an
 * explicitly configured external-provider token store.
 */
async function main(): Promise<void> {
  const explicitHomeDir = process.env['SPIDERBYTE_SDK_AUTH_SMOKE_HOME'];
  const homeDir = explicitHomeDir ?? (await mkdtemp(join(tmpdir(), 'spiderbyte-sdk-auth-smoke-')));
  const harness = createSpiderByteHarness({ homeDir, identity: smokeIdentityFromEnv() });

  try {
    const status = await harness.auth.status('local');
    if (status.loggedIn !== false || status.mode !== 'local') {
      throw new Error('local auth status did not remain accountless');
    }
    process.stdout.write(`home: ${homeDir}\n`);
    process.stdout.write(`provider: ${status.providerName}\n`);
    process.stdout.write(`has token: ${String(status.hasToken)}\n`);
    process.stdout.write('accountless auth smoke passed\n');
  } finally {
    await harness.close();
    if (explicitHomeDir === undefined) {
      await rm(homeDir, { recursive: true, force: true });
    }
  }
}

try {
  await main();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
