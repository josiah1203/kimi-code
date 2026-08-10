/**
 * Scenario: customer-managed worker HTTP boundary.
 * Responsibilities: authenticate control-plane requests, advertise readiness,
 * deduplicate execution, and cancel an active request.
 * Wiring: the real worker server is exercised over loopback; the executor is
 * the single stubbed external runtime boundary.
 * Run: pnpm --filter @moonshot-ai/agent-core-v2 exec vitest run test/workspace/execution/platformWorker.test.ts
 */

import type { AddressInfo } from 'node:net';

import { describe, expect, it } from 'vitest';

import {
  createBuiltinMlWorkerExecutor,
  createPlatformWorkerServer,
  createPlatformWorkerState,
  executePlatformWorkerRequest,
  type PlatformWorkerOptions,
  type PlatformWorkerResponse,
  unavailablePlatformWorkerExecutor,
} from '#/workspace/execution/platformWorker';

const request = {
  protocol_version: 1 as const,
  workspace_id: 'wd_worker_test',
  run_id: 'run_worker_test',
  request_id: 'worker-request-1',
  target_id: 'target_worker_test',
  operation: 'analysis' as const,
  payload: { dataset_artifact_id: 'artifact_dataset' },
};

describe('platform worker execution boundary', () => {
  it('deduplicates execution requests in the shared worker state', async () => {
    let calls = 0;
    const options: PlatformWorkerOptions = {
      workerId: 'worker_test',
      capabilities: ['analysis'],
      token: 'opaque-worker-token',
      executor: {
        execute: async () => {
          calls += 1;
          return {
            status: 'succeeded',
            output_artifacts: [{
              name: 'worker-report.json',
              kind: 'metrics',
              content_base64: Buffer.from('{"ok":true}').toString('base64'),
              media_type: 'application/json',
            }],
            metrics: { rows: 2 },
          };
        },
      },
    };
    const state = createPlatformWorkerState();
    await expect(executePlatformWorkerRequest(options, request, state)).resolves.toMatchObject({
      status: 'succeeded',
      metrics: { rows: 2 },
    });
    await expect(executePlatformWorkerRequest(options, request, state)).resolves.toMatchObject({
      status: 'succeeded',
    });
    expect(calls).toBe(1);
  });

  it('returns an explicit capability failure instead of simulating unsupported work', async () => {
    const options: PlatformWorkerOptions = {
      workerId: 'worker_analysis_only',
      capabilities: ['analysis'],
      token: 'opaque-worker-token',
      executor: unavailablePlatformWorkerExecutor,
    };
    await expect(executePlatformWorkerRequest(options, { ...request, operation: 'training' }, createPlatformWorkerState()))
      .resolves.toMatchObject({
        status: 'failed',
        error: "worker does not advertise 'training' capability",
      });
  });

  it('runs bounded analysis and baseline training from transferred input artifacts', async () => {
    const executor = createBuiltinMlWorkerExecutor('worker_builtin');
    const dataset = Buffer.from('tenure,churned\n1,yes\n2,no\n3,no\n').toString('base64');
    const trainingRequest = {
      ...request,
      request_id: 'worker-training-1',
      operation: 'training' as const,
      payload: {
        dataset_artifact_id: 'artifact_dataset',
        input_artifacts: [{ artifact_id: 'artifact_dataset', name: 'sales.csv', kind: 'dataset', content_base64: dataset }],
        target: 'churned',
        features: ['tenure'],
        task: 'classification',
        algorithm: 'nearest_centroid',
      },
    };
    await expect(executor.execute(trainingRequest, new AbortController().signal)).resolves.toMatchObject({
      status: 'succeeded',
      metrics: { accuracy: 2 / 3 },
      output_artifacts: expect.arrayContaining([
        expect.objectContaining({ kind: 'model' }),
        expect.objectContaining({ kind: 'bundle' }),
      ]),
    });
  });

  it('authenticates health and deduplicates the same execution request over HTTP', async () => {
    let calls = 0;
    const worker = createPlatformWorkerServer({
      workerId: 'worker_http',
      capabilities: ['analysis'],
      token: 'opaque-worker-token',
      executor: {
        execute: async () => {
          calls += 1;
          return { status: 'succeeded', output_artifacts: [] };
        },
      },
    });
    const baseUrl = await listen(worker.server);
    try {
      const health = await fetch(`${baseUrl}/health`);
      await expect(health.json()).resolves.toMatchObject({
        status: 'ready',
        worker_id: 'worker_http',
        capabilities: ['analysis'],
      });

      const unauthorized = await fetch(`${baseUrl}/v1/capabilities`);
      expect(unauthorized.status).toBe(401);

      const headers = {
        authorization: 'Bearer opaque-worker-token',
        'content-type': 'application/json',
      };
      const first = await fetch(`${baseUrl}/v1/execute`, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      });
      const second = await fetch(`${baseUrl}/v1/execute`, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      });
      await expect(first.json()).resolves.toMatchObject({ status: 'succeeded' });
      await expect(second.json()).resolves.toMatchObject({ status: 'succeeded' });
      expect(calls).toBe(1);
    } finally {
      await close(worker.server);
    }
  });

  it('returns a failed execution when an authenticated caller cancels the active request', async () => {
    let startedResolve!: () => void;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    const worker = createPlatformWorkerServer({
      workerId: 'worker_cancel',
      capabilities: ['analysis'],
      token: 'opaque-worker-token',
      executor: {
        execute: async (_request, signal): Promise<PlatformWorkerResponse> => {
          startedResolve();
          await new Promise<never>((_resolve, reject) => {
            if (signal.aborted) {
              reject(new Error('cancelled'));
              return;
            }
            signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
          });
          throw new Error('unreachable');
        },
      },
    });
    const baseUrl = await listen(worker.server);
    try {
      const headers = {
        authorization: 'Bearer opaque-worker-token',
        'content-type': 'application/json',
      };
      const execution = fetch(`${baseUrl}/v1/execute`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...request, request_id: 'worker-http-cancel' }),
      });
      await started;

      const cancellation = await fetch(`${baseUrl}/v1/execute/worker-http-cancel`, {
        method: 'DELETE',
        headers: { authorization: 'Bearer opaque-worker-token' },
      });
      await expect(cancellation.json()).resolves.toEqual({ cancelled: true });
      await expect((await execution).json()).resolves.toMatchObject({
        status: 'failed',
        error: 'cancelled',
      });
    } finally {
      await close(worker.server);
    }
  });
});

async function listen(server: import('node:http').Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('worker did not expose a TCP address');
  return `http://127.0.0.1:${String((address as AddressInfo).port)}`;
}

async function close(server: import('node:http').Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
