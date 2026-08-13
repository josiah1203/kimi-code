/** Provider command adapter tests use a real child process fixture so parsing,
 * argv isolation, stream handling, timeout, cancellation, and redaction are
 * verified at the Kaos boundary rather than against a mocked process. */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { getCurrentKaos } from '#/current';
import {
  LocalProviderCommandAdapter,
  ProviderCommandError,
  isVersionSupported,
  type ProviderCommandSpec,
} from '#/provider-command';

const fixture = fileURLToPath(new URL('./fixtures/provider-cli.cjs', import.meta.url));

function makeSpec(overrides: Partial<ProviderCommandSpec> = {}): ProviderCommandSpec {
  return {
    id: 'fixture',
    displayName: 'Fixture Provider',
    executable: process.execPath,
    versionArgs: [fixture, 'version'],
    modelsArgs: [fixture, 'models'],
    runArgs: [fixture, 'run', '--json', '--model', '{model}'],
    environment: { SPIDERBYTE_FIXTURE_MODE: 'normal' },
    capabilities: { streaming: true, usageMetadata: true },
    ...overrides,
  };
}

function makeAdapter(overrides: Partial<ProviderCommandSpec> = {}): LocalProviderCommandAdapter {
  return new LocalProviderCommandAdapter(getCurrentKaos(), makeSpec(overrides));
}

describe('LocalProviderCommandAdapter', () => {
  it('detects an executable and accepts a supported version range', async () => {
    const adapter = makeAdapter({ supportedVersionRange: '>=1.0.0 <2.0.0' });

    await expect(adapter.version()).resolves.toBe('1.2.3');
    await expect(adapter.detect()).resolves.toMatchObject({
      available: true,
      code: 'available',
      version: '1.2.3',
    });
  });

  it('reports an unsupported version without claiming the command is available', async () => {
    const adapter = makeAdapter({ supportedVersionRange: '>=2.0.0' });

    await expect(adapter.detect()).resolves.toMatchObject({
      available: false,
      code: 'unsupported_version',
      version: '1.2.3',
    });
  });

  it('parses structured model output and advertises configured capabilities', async () => {
    const adapter = makeAdapter();

    await expect(adapter.models()).resolves.toEqual([
      expect.objectContaining({ id: 'fixture-small', displayName: 'Fixture Small' }),
      expect.objectContaining({ id: 'fixture-large', contextWindow: 128000 }),
    ]);
    await expect(adapter.capabilities()).resolves.toMatchObject({
      available: true,
      streaming: true,
      modelSelection: true,
      modelListing: true,
      structuredOutput: true,
      nonInteractive: true,
    });
  });

  it('streams text and usage events and completes after a zero exit', async () => {
    const adapter = makeAdapter();
    const events = [];
    for await (const event of adapter.run({
      requestId: 'stream-request',
      prompt: 'hello',
      model: 'fixture-small',
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { kind: 'started', requestId: 'stream-request' },
      { kind: 'text', requestId: 'stream-request', text: 'hello fixture-small: hello' },
      {
        kind: 'usage',
        requestId: 'stream-request',
        usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
      },
      {
        kind: 'completed',
        requestId: 'stream-request',
        exitCode: 0,
        usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
      },
    ]);
  });

  it('carries Run and Attempt provenance through every provider lifecycle event', async () => {
    const adapter = makeAdapter();
    const trace = {
      runId: 'run_provider_trace',
      attemptId: 'attempt_provider_trace',
      workspaceId: 'wd_test_0123456789ab',
      projectId: 'project_demo',
      executionTargetId: 'target_local',
      provider: 'fixture',
      model: 'fixture-small',
      userId: 'user_demo',
      policyDecisionIds: ['policy_provider_trace'],
      approvalIds: ['approval_provider_trace'],
    } as const;
    const events = [];
    for await (const event of adapter.run({
      requestId: 'trace-request',
      prompt: 'hello',
      model: 'fixture-small',
      trace,
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(4);
    expect(events.every((event) => event.trace === trace)).toBe(true);
  });

  it('cancels an active request by request id', async () => {
    const adapter = makeAdapter({ environment: { SPIDERBYTE_FIXTURE_MODE: 'hang' } });
    const iterator = adapter.run({ requestId: 'cancel-request', prompt: 'hello' })[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { kind: 'started', requestId: 'cancel-request' },
    });
    const pending = iterator.next();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await adapter.cancel('cancel-request');
    await expect(pending).rejects.toMatchObject({ code: 'cancellation' });
  });

  it('propagates an AbortSignal to the provider child process', async () => {
    const adapter = makeAdapter({ environment: { SPIDERBYTE_FIXTURE_MODE: 'hang' } });
    const controller = new AbortController();
    const iterator = adapter.run({
      requestId: 'signal-cancel-request',
      prompt: 'hello',
      signal: controller.signal,
    })[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { kind: 'started', requestId: 'signal-cancel-request' },
    });
    const pending = iterator.next();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancellation' });
  });

  it('terminates a request that exceeds its timeout', async () => {
    const adapter = makeAdapter({ environment: { SPIDERBYTE_FIXTURE_MODE: 'hang' } });

    const collect = async (): Promise<void> => {
      for await (const _event of adapter.run({ requestId: 'timeout-request', prompt: 'hello', timeoutMs: 40 })) {
        // Consume the stream so the adapter owns the process lifecycle.
      }
    };
    await expect(collect()).rejects.toMatchObject({ code: 'timeout' });
  });

  it('rejects human-oriented or malformed output instead of scraping it', async () => {
    const adapter = makeAdapter({ environment: { SPIDERBYTE_FIXTURE_MODE: 'malformed' } });

    await expect(async () => {
      for await (const _event of adapter.run({ requestId: 'malformed-request', prompt: 'hello' })) {
        // The malformed line is expected to reject before completion.
      }
    }).rejects.toMatchObject({ code: 'malformed_output' });
  });

  it('bounds structured stdout before buffering an untrusted provider line', async () => {
    const adapter = makeAdapter({
      environment: { SPIDERBYTE_FIXTURE_MODE: 'large-output' },
      maxOutputBytes: 64,
    });

    await expect(async () => {
      for await (const _event of adapter.run({ requestId: 'large-output-request', prompt: 'hello' })) {
        // The bounded reader is expected to reject before completion.
      }
    }).rejects.toMatchObject({ code: 'malformed_output' });
  });

  it('classifies a missing executable during detection', async () => {
    const adapter = makeAdapter({ executable: join('/tmp', 'spiderbyte-provider-does-not-exist') });

    await expect(adapter.detect()).resolves.toMatchObject({
      available: false,
      code: 'executable_missing',
      version: null,
    });
  });

  it('classifies nonzero provider exits and redacts configured secrets', async () => {
    const adapter = makeAdapter({
      environment: {
        SPIDERBYTE_FIXTURE_MODE: 'auth-failure',
        PROVIDER_TOKEN: 'super-secret',
      },
    });

    let caught: unknown;
    try {
      for await (const _event of adapter.run({ requestId: 'auth-request', prompt: 'hello' })) {
        // The provider is expected to fail after startup.
      }
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProviderCommandError);
    expect(caught).toMatchObject({ code: 'authentication_failure' });
    expect((caught as ProviderCommandError).message).not.toContain('super-secret');
    expect((caught as ProviderCommandError).stderr).not.toContain('super-secret');
    expect((caught as ProviderCommandError).message).toContain('[REDACTED]');
  });

  it('redacts configured secrets from structured provider output', async () => {
    const adapter = makeAdapter({
      environment: {
        SPIDERBYTE_FIXTURE_MODE: 'secret-output',
        PROVIDER_AUTH: 'super-secret',
      },
      redactionSecrets: ['super-secret'],
    });

    const events = [];
    for await (const event of adapter.run({ requestId: 'secret-output-request', prompt: 'hello' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { kind: 'started', requestId: 'secret-output-request' },
      { kind: 'text', requestId: 'secret-output-request', text: 'provider output token=[REDACTED]' },
      {
        kind: 'metadata',
        requestId: 'secret-output-request',
        metadata: { diagnostic: 'token=[REDACTED]' },
      },
      { kind: 'completed', requestId: 'secret-output-request', exitCode: 0 },
    ]);
    expect(JSON.stringify(events)).not.toContain('super-secret');
  });

  it('reports unsupported model listing explicitly', async () => {
    const adapter = makeAdapter({ modelsArgs: undefined });

    await expect(adapter.models()).rejects.toMatchObject({ code: 'unsupported_capability' });
    await expect(adapter.capabilities()).resolves.toMatchObject({
      available: true,
      modelListing: false,
    });
  });
});

describe('provider version range helper', () => {
  it('evaluates exact, comparator, caret, tilde, and alternative ranges', () => {
    expect(isVersionSupported('1.2.3', '>=1.0.0 <2.0.0')).toBe(true);
    expect(isVersionSupported('1.2.3', '^1.2.0')).toBe(true);
    expect(isVersionSupported('1.2.3', '~1.2.0')).toBe(true);
    expect(isVersionSupported('2.0.0', '^1.2.0 || ^2.0.0')).toBe(true);
    expect(isVersionSupported('2.0.0', '<2.0.0')).toBe(false);
  });
});
