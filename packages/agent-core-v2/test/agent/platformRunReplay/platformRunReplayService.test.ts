/**
 * Scenario: durable platform Run replay.
 * Responsibilities: a queued child Run reuses its secret-free operation
 * descriptor, reaches a terminal state with artifact references, and does not
 * execute again after restart/idempotent re-entry.
 */

import { describe, expect, it } from 'vitest';

import type { Run } from '@moonshot-ai/protocol';
import type { IWorkspaceArtifactService } from '#/workspace/artifacts/artifact';
import type { IWorkspaceDatasetService } from '#/workspace/datasets/dataset';
import type { IWorkspaceMlService } from '#/workspace/ml/ml';
import type { IWorkspacePipelineService } from '#/workspace/pipelines/pipeline';
import type { IWorkspaceProviderConnectionService } from '#/workspace/providerConnections/providerConnection';
import type { IWorkspaceProviderRuntimeService } from '#/workspace/providerConnections/providerRuntime';
import type { IWorkspaceResourceService } from '#/workspace/resources/resource';
import type { IWorkspaceServingService } from '#/workspace/serving/serving';
import type { IWorkspacePolicyService } from '#/workspace/policy/policy';
import type { ISessionRunService } from '#/session/run/run';
import { DatasetErrors, DatasetServiceError } from '#/workspace/datasets/errors';
import { PlatformRunReplayService } from '#/agent/platformRunReplay/platformRunReplayService';

const baseRun: Run = {
  id: 'run_replay_child',
  workspace_id: 'wd_test_0123456789ab',
  agent_session_id: 'ses_test',
  request_id: 'platform:test:child',
  parent_run_id: 'run_replay_parent',
  status: 'queued',
  created_at: '2026-08-08T00:00:00.000Z',
  updated_at: '2026-08-08T00:00:00.000Z',
  metadata: {
    kind: 'dataset_profile',
    platform_operation: {
      version: 1,
      domain: 'dataset',
      operation: 'profile',
      input: { dataset_id: 'dataset_sales', version: 1 },
    },
  },
};

function runs(initial = baseRun): {
  service: ISessionRunService;
  getCurrent: () => Run;
  transitions: string[];
} {
  let current = initial;
  const transitions: string[] = [];
  const service = {
    _serviceBrand: undefined,
    ready: Promise.resolve(),
    list: async () => [current],
    get: async () => current,
    create: async () => current,
    transition: async (_id: string, input: { status: Run['status']; output_artifacts?: Run['output_artifacts'] }) => {
      transitions.push(input.status);
      current = {
        ...current,
        status: input.status,
        output_artifacts: input.output_artifacts ?? current.output_artifacts,
      };
      return current;
    },
    cancel: async () => current,
    retry: async () => current,
    rerun: async () => current,
    fork: async () => current,
    onDidChange: (() => ({ dispose: () => {} })) as never,
  } as unknown as ISessionRunService;
  return { service, getCurrent: () => current, transitions };
}

function replay(
  runService: ISessionRunService,
  dataset: IWorkspaceDatasetService,
  artifacts: IWorkspaceArtifactService,
): PlatformRunReplayService {
  return new PlatformRunReplayService(
    runService,
    artifacts,
    dataset,
    {} as IWorkspaceProviderConnectionService,
    {} as IWorkspaceProviderRuntimeService,
    {} as IWorkspaceResourceService,
    {} as IWorkspaceMlService,
    {} as IWorkspacePipelineService,
    {} as IWorkspaceServingService,
    {
      get: async (id: string) => ({
        id,
        capability: 'dataset',
        outcome: 'allow',
        state: 'approved',
      }),
    } as unknown as IWorkspacePolicyService,
  );
}

describe('PlatformRunReplayService', () => {
  it('replays a dataset profile and records output artifacts on the child Run', async () => {
    const state = runs();
    let profileCalls = 0;
    const dataset = {
      profile: async (_id: string, input: { request_id: string }) => {
        profileCalls += 1;
        expect(input.request_id).toBe('platform:replay:run_replay_child:dataset:profile:profile');
        return {
          dataset_id: 'dataset_sales',
          version: 1,
          row_count: 2,
          columns: [],
          artifact_id: 'artifact_profile',
          generated_at: '2026-08-08T00:00:00.000Z',
        };
      },
    } as unknown as IWorkspaceDatasetService;
    const artifacts = {
      get: async () => ({
        id: 'artifact_profile',
        workspace_id: 'wd_test_0123456789ab',
        name: 'sales.profile.json',
        kind: 'metrics' as const,
        version: 3,
        content_ref: 'blob_profile',
        size_bytes: 32,
        sha256: 'a'.repeat(64),
        created_at: '2026-08-08T00:00:00.000Z',
      }),
    } as unknown as IWorkspaceArtifactService;

    const result = await replay(state.service, dataset, artifacts).replay(
      baseRun.id,
      'platform:first-request',
    );

    expect(result.replayable).toBe(true);
    expect(result.run.status).toBe('succeeded');
    expect(result.run.output_artifacts).toEqual([{ id: 'artifact_profile', version: 3 }]);
    expect(profileCalls).toBe(1);
    expect(state.transitions).toEqual(['planning', 'running', 'succeeded']);
  });

  it('projects a policy gate into awaiting_approval without exposing secret payloads', async () => {
    const state = runs();
    const dataset = {
      profile: async () => {
        throw new DatasetServiceError(
          DatasetErrors.codes.DATASET_POLICY_REQUIRED,
          'dataset policy approval is required',
          { policyDecisionId: 'decision_profile' },
        );
      },
    } as unknown as IWorkspaceDatasetService;

    const result = await replay(
      state.service,
      dataset,
      {} as IWorkspaceArtifactService,
    ).replay(baseRun.id, 'platform:approval-request');

    expect(result.replayable).toBe(true);
    expect(result.approval_required).toBe(true);
    expect(result.policy_decision_id).toBe('decision_profile');
    expect(result.run.status).toBe('awaiting_approval');
    expect(result.error).toContain('dataset.policy_required');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('does not invoke a terminal Run again after restart/re-entry', async () => {
    const state = runs();
    let profileCalls = 0;
    const dataset = {
      profile: async () => {
        profileCalls += 1;
        return {
          dataset_id: 'dataset_sales',
          version: 1,
          row_count: 0,
          columns: [],
          artifact_id: 'artifact_profile',
          generated_at: '2026-08-08T00:00:00.000Z',
        };
      },
    } as unknown as IWorkspaceDatasetService;
    const artifacts = {
      get: async () => ({ id: 'artifact_profile', version: 1 }),
    } as unknown as IWorkspaceArtifactService;
    const service = replay(state.service, dataset, artifacts);

    await service.replay(baseRun.id, 'platform:first-request');
    const second = await service.replay(baseRun.id, 'platform:after-restart');

    expect(second.run.status).toBe('succeeded');
    expect(profileCalls).toBe(1);
    expect(state.transitions).toEqual(['planning', 'running', 'succeeded']);
  });

  it('reuses the approved decision when an awaiting Run is resumed', async () => {
    const state = runs({
      ...baseRun,
      status: 'awaiting_approval',
      policy_decision_ids: ['decision_profile'],
    });
    const dataset = {
      profile: async (_id: string, input: { policy_decision_id?: string }) => {
        expect(input.policy_decision_id).toBe('decision_profile');
        return {
          dataset_id: 'dataset_sales',
          version: 1,
          row_count: 0,
          columns: [],
          artifact_id: 'artifact_profile',
          generated_at: '2026-08-08T00:00:00.000Z',
        };
      },
    } as unknown as IWorkspaceDatasetService;
    const artifacts = {
      get: async () => ({ id: 'artifact_profile', version: 1 }),
    } as unknown as IWorkspaceArtifactService;

    await state.service.transition(baseRun.id, {
      request_id: 'platform:resume',
      status: 'running',
    });
    const result = await replay(state.service, dataset, artifacts).replay(
      baseRun.id,
      'platform:resume-replay',
    );

    expect(result.run.status).toBe('succeeded');
    expect(result.approval_required).toBeUndefined();
  });
});
