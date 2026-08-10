import { describe, expect, it } from 'vitest';

import {
  createBuiltinMlWorkerExecutor,
  createPlatformWorkerState,
  executePlatformWorkerRequest,
  type PlatformWorkerOptions,
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
});
