import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { isConfinedSshDaemonRoot } from '#/workspace/execution/sshDaemonProtocol';
import { runSshDaemonStdio } from '#/workspace/execution/sshDaemonStdio';

const environment = {
  SPIDERBYTE_PROTOCOL_VERSION: '1',
  SPIDERBYTE_WORKSPACE_ID: 'workspace-a',
};
const root = '/srv/spiderbyte/workspaces/demo';

async function run(frame: unknown, options: { readonly cwd?: string; readonly extra?: string } = {}): Promise<Record<string, unknown>> {
  const chunks: string[] = [];
  await runSshDaemonStdio({
    input: Readable.from([`${JSON.stringify(frame)}\n${options.extra ?? ''}`]),
    output: { write: (chunk: string) => { chunks.push(chunk); return true; } } as unknown as NodeJS.WritableStream,
    environment,
    currentWorkingDirectory: options.cwd ?? root,
    daemonVersion: '0.3.1-test',
  });
  return JSON.parse(chunks.join('')) as Record<string, unknown>;
}

describe('SSH daemon stdio contract', () => {
  it('rejects control characters in an independently checked daemon root', () => {
    expect(isConfinedSshDaemonRoot(root)).toBe(true);
    expect(isConfinedSshDaemonRoot(`${root}/\u0000`)).toBe(false);
    expect(isConfinedSshDaemonRoot(`${root}/\u001f`)).toBe(false);
    expect(isConfinedSshDaemonRoot(`${root}/\u007f`)).toBe(false);
  });

  it('answers a bounded probe with only implemented semantic capabilities', async () => {
    const response = await run({
      kind: 'probe',
      protocol_version: 1,
      request_id: 'probe-1',
      workspace_id: 'workspace-a',
      target_id: 'target-1',
      workspace_root: root,
    });
    expect(response).toMatchObject({
      kind: 'probe_result',
      daemon: 'spiderbyte',
      protocol_version: 1,
      workspace_id: 'workspace-a',
      target_id: 'target-1',
      status: 'ready',
      capabilities: ['execute_analysis', 'profile_dataset', 'train_model'],
    });
  });

  it('executes analysis through the built-in worker without shell input', async () => {
    const response = await run({
      kind: 'execute',
      protocol_version: 1,
      request_id: 'execute-1',
      run_id: 'run-1',
      workspace_id: 'workspace-a',
      target_id: 'target-1',
      workspace_root: root,
      operation: 'execute_analysis',
      payload: {
        dataset_artifact_id: 'artifact-1',
        input_artifacts: [{
          artifact_id: 'artifact-1',
          name: 'data.csv',
          kind: 'dataset',
          media_type: 'text/csv',
          content_base64: Buffer.from('feature,target\n1,yes\n2,no\n').toString('base64'),
        }],
      },
    });
    expect(response).toMatchObject({
      kind: 'execute_result',
      response: { status: 'succeeded' },
    });
    expect(JSON.stringify(response)).not.toContain('shell');
  });

  it('rejects a cross-workspace, wrong-root, or multi-frame request', async () => {
    await expect(run({
      kind: 'probe',
      protocol_version: 1,
      request_id: 'probe-cross-workspace',
      workspace_id: 'workspace-b',
      target_id: 'target-1',
      workspace_root: root,
    })).resolves.toMatchObject({ kind: 'error', error: expect.stringMatching(/workspace/) });
    await expect(run({
      kind: 'probe',
      protocol_version: 1,
      request_id: 'probe-wrong-root',
      workspace_id: 'workspace-a',
      target_id: 'target-1',
      workspace_root: '/srv/spiderbyte/workspaces/other',
    }, { cwd: root })).resolves.toMatchObject({ kind: 'error', error: expect.stringMatching(/root/) });
    await expect(run({
      kind: 'probe',
      protocol_version: 1,
      request_id: 'probe-extra-frame',
      workspace_id: 'workspace-a',
      target_id: 'target-1',
      workspace_root: root,
    }, { extra: '{}\n' })).resolves.toMatchObject({ kind: 'error', error: expect.stringMatching(/exactly one/) });
  });
});
