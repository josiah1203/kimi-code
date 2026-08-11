/**
 * Scenario: conversational platform adapters.
 * Responsibilities: Dataset projects native query results onto a durable Run;
 * Provider never exposes a connection secret. The tool implementations are
 * real; workspace/session service interfaces are the only stubbed boundaries.
 * Run with `pnpm --filter @spiderbyte/agent-core exec vitest run
 * test/agent/tools/platform/platformTools.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import type { ExecutableToolContext } from '#/tool/toolContract';
import type { IWorkspaceArtifactService } from '#/workspace/artifacts/artifact';
import type { IWorkspaceDatasetService } from '#/workspace/datasets/dataset';
import type { IWorkspaceProviderConnectionService } from '#/workspace/providerConnections/providerConnection';
import type { IWorkspaceProviderRuntimeService } from '#/workspace/providerConnections/providerRuntime';
import type { IPlatformModelBindingService } from '#/agent/platformModelBinding/platformModelBinding';
import type { IPlatformRunReplayService } from '#/agent/platformRunReplay/platformRunReplay';
import type { IPlatformConversationService } from '#/agent/platformConversation/platformConversation';
import type { IPlatformApprovalService } from '#/agent/platformApproval/platformApproval';
import type { ISessionRunService } from '#/session/run/run';
import type { IWorkspaceMlService } from '#/workspace/ml/ml';
import type { IWorkspacePipelineService } from '#/workspace/pipelines/pipeline';
import type { IWorkspaceExecutionTargetService } from '#/workspace/executionTargets/executionTarget';
import { DatasetErrors, DatasetServiceError } from '#/workspace/datasets/errors';
import type { Run } from '@spiderbyte/protocol';
import { ArtifactTool, DatasetTool, ExecutionTargetTool, MlTool, PipelineTool, ProviderTool, RunTool } from '#/agent/tools/platform/platformToolImplementations';

const context: ExecutableToolContext = {
  turnId: 1,
  toolCallId: 'tool_platform_test',
  signal: new AbortController().signal,
};

function runs(): ISessionRunService {
  let current: Run = {
    id: 'run_test',
    workspace_id: 'wd_test_0123456789ab',
    agent_session_id: 'ses_test',
    request_id: 'request_test',
    status: 'queued',
    created_at: '2026-08-08T00:00:00.000Z',
    updated_at: '2026-08-08T00:00:00.000Z',
  };
  return {
    _serviceBrand: undefined,
    ready: Promise.resolve(),
    list: async () => [current],
    get: async () => current,
    create: async () => current,
    transition: async (_id, input) => {
      current = { ...current, status: input.status };
      return current;
    },
    resume: async () => current,
    cancel: async () => current,
    retry: async () => current,
    rerun: async () => current,
    fork: async () => current,
    onDidChange: (() => ({ dispose: () => {} })) as never,
  };
}

describe('platform conversation tools (native service projection)', () => {
  it('creates a manual durable Run through the Run tool', async () => {
    let input: unknown;
    const service = runs();
    const originalCreate = service.create;
    service.create = async (value) => {
      input = value;
      return originalCreate(value);
    };
    const tool = new RunTool(service);
    const execution = tool.resolveExecution({
      operation: 'create',
      kind: 'analysis',
      metadata: { source: 'conversation' },
    });
    if ('isError' in execution) throw new Error('tool did not resolve');

    const result = await execution.execute(context);

    expect(result).toMatchObject({ isError: false });
    expect(input).toMatchObject({
      metadata: { kind: 'analysis', source: 'conversation' },
      request_id: 'platform:tool_platform_test:run:create',
    });
  });

  it('replays a retry child Run through the durable platform coordinator', async () => {
    const service = runs();
    const child: Run = {
      ...(await service.get('run_test'))!,
      id: 'run_retry_child',
      status: 'queued',
      metadata: {
        platform_operation: {
          version: 1,
          domain: 'dataset',
          operation: 'profile',
          input: { dataset_id: 'dataset_sales' },
        },
      },
    };
    service.retry = async () => child;
    const replay = {
      replay: async () => ({
        run: { ...child, status: 'succeeded' as const },
        replayable: true,
        result: { dataset_id: 'dataset_sales' },
      }),
    } as unknown as IPlatformRunReplayService;
    const tool = new RunTool(service, replay);
    const execution = tool.resolveExecution({ operation: 'retry', run_id: 'run_test' });
    if ('isError' in execution) throw new Error('tool did not resolve');

    const result = await execution.execute(context);

    expect(result).toMatchObject({ isError: false });
    expect(String(result.output)).toContain('run_retry_child');
    expect(String(result.output)).toContain('dataset_sales');
  });

  it('resolves conversational Run aliases before lifecycle actions', async () => {
    const service = runs();
    const conversation = {
      resolveRunReference: async (reference: string) => {
        expect(reference).toBe('last run');
        return service.get('run_test');
      },
    } as unknown as IPlatformConversationService;
    const tool = new RunTool(service, undefined, conversation);
    const execution = tool.resolveExecution({ operation: 'inspect', run_id: 'last run' });
    if ('isError' in execution) throw new Error('tool did not resolve');

    const result = await execution.execute(context);

    expect(result).toMatchObject({ isError: false });
    expect(String(result.output)).toContain('run_test');
  });

  it('creates a Run and returns the query artifact when a dataset query succeeds', async () => {
    const dataset = {
      _serviceBrand: undefined,
      list: async () => [],
      get: async () => undefined,
      create: async () => {
        throw new Error('not used');
      },
      createVersion: async () => undefined,
      profile: async () => undefined,
      query: async () => ({
        dataset_id: 'dataset_sales',
        version: 1,
        columns: ['region', 'count'],
        rows: [['west', 3]],
        row_count: 1,
        truncated: false,
        artifact_id: 'artifact_query',
        run_id: 'run_test',
        policy_decision_id: 'policy_allow',
      }),
      transform: async () => {
        return {
          id: 'dataset_sales',
          workspace_id: 'wd_test_0123456789ab',
          name: 'sales',
          format: 'csv' as const,
          current_version: 2,
          versions: [{ version: 2, artifact_id: 'artifact_transform', row_count: 1, columns: [], created_at: '2026-08-08T00:00:00.000Z' }],
          created_at: '2026-08-08T00:00:00.000Z',
          updated_at: '2026-08-08T00:00:00.000Z',
        };
      },
      ready: Promise.resolve(),
    } as unknown as IWorkspaceDatasetService;
    const artifacts = {
      get: async () => ({
        id: 'artifact_query',
        workspace_id: 'wd_test_0123456789ab',
        name: 'sales.query.json',
        kind: 'table' as const,
        version: 1,
        content_ref: 'blob_hash',
        size_bytes: 128,
        sha256: 'hash',
        created_at: '2026-08-08T00:00:00.000Z',
      }),
    } as unknown as IWorkspaceArtifactService;
    const tool = new DatasetTool(dataset, runs(), artifacts);
    const execution = tool.resolveExecution({
      operation: 'query',
      dataset_id: 'dataset_sales',
      sql: 'select region, count(*) as count from dataset group by region',
    });
    if ('isError' in execution) throw new Error('tool did not resolve');

    const result = await execution.execute(context);

    expect(result).toMatchObject({ isError: false });
    expect(String(result.output)).toContain('artifact_query');
    expect(String(result.output)).toContain('run_test');
  });

  it('creates a Run for a governed SQL dataset transformation', async () => {
    let transformInput: unknown;
    const dataset = {
      _serviceBrand: undefined,
      list: async () => [],
      get: async () => undefined,
      create: async () => { throw new Error('not used'); },
      createVersion: async () => undefined,
      profile: async () => undefined,
      query: async () => undefined,
      transform: async (_id: string, input: unknown) => {
        transformInput = input;
        return {
          id: 'dataset_sales',
          workspace_id: 'wd_test_0123456789ab',
          name: 'sales',
          format: 'csv' as const,
          current_version: 2,
          versions: [{ version: 2, artifact_id: 'artifact_transform', row_count: 1, columns: [], created_at: '2026-08-08T00:00:00.000Z' }],
          created_at: '2026-08-08T00:00:00.000Z',
          updated_at: '2026-08-08T00:00:00.000Z',
        };
      },
      ready: Promise.resolve(),
    } as unknown as IWorkspaceDatasetService;
    const artifacts = {
      get: async () => ({
        id: 'artifact_transform',
        workspace_id: 'wd_test_0123456789ab',
        name: 'sales.v2.csv',
        kind: 'dataset' as const,
        version: 1,
        content_ref: 'blob_transform',
        size_bytes: 32,
        sha256: 'hash',
        created_at: '2026-08-08T00:00:00.000Z',
      }),
    } as unknown as IWorkspaceArtifactService;
    const tool = new DatasetTool(dataset, runs(), artifacts);
    const execution = tool.resolveExecution({
      operation: 'transform',
      dataset_id: 'dataset_sales',
      sql: 'select region from dataset',
      metadata: { feature_set: 'region' },
    });
    if ('isError' in execution) throw new Error('tool did not resolve');

    const result = await execution.execute(context);

    expect(result).toMatchObject({ isError: false });
    expect(transformInput).toMatchObject({
      request_id: 'platform:tool_platform_test:dataset:transform',
      run_id: 'run_test',
      sql: 'select region from dataset',
      metadata: { feature_set: 'region' },
    });
    expect(String(result.output)).toContain('artifact_transform');
    expect(String(result.output)).toContain('run_test');
  });

  it('resolves a conversational dataset reference before native profiling', async () => {
    let profiledDatasetId: string | undefined;
    const dataset = {
      _serviceBrand: undefined,
      list: async () => [],
      get: async () => undefined,
      create: async () => { throw new Error('not used'); },
      createVersion: async () => undefined,
      profile: async (id: string) => {
        profiledDatasetId = id;
        return {
          dataset_id: id,
          version: 1,
          row_count: 1,
          columns: [],
          artifact_id: 'artifact_profile',
          generated_at: '2026-08-08T00:00:00.000Z',
        };
      },
      query: async () => undefined,
      ready: Promise.resolve(),
    } as unknown as IWorkspaceDatasetService;
    const artifacts = {
      get: async () => undefined,
    } as unknown as IWorkspaceArtifactService;
    const conversation = {
      resolveDatasetReference: async (reference: string) => {
        expect(reference).toBe('last');
        return 'dataset_sales';
      },
    } as unknown as IPlatformConversationService;
    const tool = new DatasetTool(dataset, runs(), artifacts, conversation);
    const execution = tool.resolveExecution({ operation: 'profile', dataset_id: 'last' });
    if ('isError' in execution) throw new Error('tool did not resolve');

    const result = await execution.execute(context);

    expect(result).toMatchObject({ isError: false });
    expect(profiledDatasetId).toBe('dataset_sales');
  });

  it('routes a dataset policy gate through the existing approval interaction', async () => {
    const dataset = {
      _serviceBrand: undefined,
      list: async () => [],
      get: async () => undefined,
      create: async () => { throw new Error('not used'); },
      createVersion: async () => undefined,
      profile: async () => {
        throw new DatasetServiceError(
          DatasetErrors.codes.DATASET_POLICY_REQUIRED,
          'dataset policy approval is required',
          { policyDecisionId: 'policy_dataset' },
        );
      },
      query: async () => undefined,
      ready: Promise.resolve(),
    } as unknown as IWorkspaceDatasetService;
    const approval = {
      request: async (input: { readonly policyDecisionId: string; readonly action: string }) => {
        expect(input.policyDecisionId).toBe('policy_dataset');
        expect(input.action).toBe('Dataset profile');
        return { decision: 'approved' as const, policyDecisionId: input.policyDecisionId };
      },
    } as unknown as IPlatformApprovalService;
    const tool = new DatasetTool(dataset, runs(), { get: async () => undefined } as unknown as IWorkspaceArtifactService, undefined, approval);
    const execution = tool.resolveExecution({ operation: 'profile', dataset_id: 'dataset_sales' });
    if ('isError' in execution) throw new Error('tool did not resolve');

    const result = await execution.execute(context);

    expect(result).toMatchObject({ isError: false });
    expect(String(result.output)).toContain('approval_required');
    expect(String(result.output)).toContain('running');
  });

  it('retrieves the artifacts attached to a conversational Run reference', async () => {
    const run = {
      ...(await runs().get('run_test'))!,
      output_artifacts: [{ id: 'artifact_report', version: 1 }],
    };
    const artifacts = {
      get: async () => ({
        id: 'artifact_report',
        workspace_id: 'wd_test_0123456789ab',
        name: 'report.json',
        kind: 'metrics' as const,
        version: 1,
        content_ref: 'blob_report',
        size_bytes: 64,
        sha256: 'a'.repeat(64),
        created_at: '2026-08-08T00:00:00.000Z',
      }),
    } as unknown as IWorkspaceArtifactService;
    const conversation = {
      resolveRunReference: async (reference: string) => {
        expect(reference).toBe('last');
        return run;
      },
    } as unknown as IPlatformConversationService;
    const tool = new ArtifactTool(artifacts, runs(), conversation);
    const execution = tool.resolveExecution({ operation: 'from_run', run_id: 'last' });
    if ('isError' in execution) throw new Error('tool did not resolve');

    const result = await execution.execute(context);

    expect(result).toMatchObject({ isError: false });
    expect(String(result.output)).toContain('artifact_report');
    expect(String(result.output)).toContain('run_test');
  });

  it('redacts secret references when provider connections are listed', async () => {
    const connection = {
      id: 'connection_openai',
      workspace_id: 'wd_test_0123456789ab',
      name: 'OpenAI',
      provider: 'openai' as const,
      scope: 'workspace' as const,
      state: 'active' as const,
      secret_ref: 'secret_should_not_leave_boundary',
      capabilities: ['chat'],
      created_at: '2026-08-08T00:00:00.000Z',
      updated_at: '2026-08-08T00:00:00.000Z',
    };
    const connections = {
      list: async () => [connection],
    } as unknown as IWorkspaceProviderConnectionService;
    const runtime = {} as IWorkspaceProviderRuntimeService;
    const binding = {
      _serviceBrand: undefined,
      current: () => undefined,
      select: async () => { throw new Error('not used'); },
      clear: () => undefined,
    } as unknown as IPlatformModelBindingService;
    const tool = new ProviderTool(connections, runtime, runs(), binding);
    const execution = tool.resolveExecution({ operation: 'list' });
    if ('isError' in execution) throw new Error('tool did not resolve');

    const result = await execution.execute(context);

    expect(result).toMatchObject({ isError: false });
    expect(String(result.output)).toContain('secret_configured');
    expect(String(result.output)).not.toContain('secret_should_not_leave_boundary');
  });

  it('projects provider selection into the agent without exposing the model requester', async () => {
    const connections = {
      list: async () => [],
    } as unknown as IWorkspaceProviderConnectionService;
    const runtime = {} as IWorkspaceProviderRuntimeService;
    let selectedInput: unknown;
    const binding = {
      _serviceBrand: undefined,
      current: () => undefined,
      select: async (input: unknown) => {
        selectedInput = input;
        return {
          connection_id: 'connection_anthropic',
          provider: 'anthropic',
          model: 'claude-test',
          model_alias: 'platform:connection_anthropic/claude-test',
          run_id: 'run_provider',
          fallback_connection_ids: ['connection_openai'],
          model_definition: { authProvider: { apiKey: 'sk_should_not_leave_tool_output' } },
          requester: {},
        };
      },
      clear: () => undefined,
    } as unknown as IPlatformModelBindingService;
    const tool = new ProviderTool(connections, runtime, runs(), binding);
    const execution = tool.resolveExecution({
      operation: 'select',
      connection_id: 'connection_anthropic',
      model: 'claude-test',
      run_id: 'run_provider',
      fallback_connection_ids: ['connection_openai'],
    });
    if ('isError' in execution) throw new Error('tool did not resolve');

    const result = await execution.execute(context);

    expect(selectedInput).toEqual({
      connection_id: 'connection_anthropic',
      model: 'claude-test',
      run_id: 'run_provider',
      fallback_connection_ids: ['connection_openai'],
    });
    expect(result).toMatchObject({ isError: false });
    expect(String(result.output)).toContain('platform:connection_anthropic/claude-test');
    expect(String(result.output)).not.toContain('sk_should_not_leave_tool_output');
  });

  it('adds an opaque provider connection and exposes model capabilities without headers', async () => {
    let createInput: unknown;
    const connections = {
      list: async () => [],
      create: async (input: unknown) => {
        createInput = input;
        return {
          ...connectionForToolTest,
          name: 'Anthropic',
          provider: 'anthropic' as const,
          secret_ref: 'secret_opaque',
        };
      },
    } as unknown as IWorkspaceProviderConnectionService;
    const runtime = {
      describe: async () => ({
        connection_id: 'connection_anthropic',
        provider: 'anthropic',
        model: 'claude-test',
        protocol: 'anthropic',
        provider_type: 'anthropic',
        base_url: 'https://api.anthropic.example.test',
        headers: { 'x-safe-header': 'value' },
        capabilities: { tool_use: true },
        max_context_size: 200_000,
      }),
    } as unknown as IWorkspaceProviderRuntimeService;
    const binding = {
      _serviceBrand: undefined,
      current: () => undefined,
      clear: () => undefined,
    } as unknown as IPlatformModelBindingService;
    const tool = new ProviderTool(connections, runtime, runs(), binding);
    const addExecution = tool.resolveExecution({
      operation: 'add',
      name: 'Anthropic',
      provider: 'anthropic',
      scope: 'workspace',
      secret_ref: 'secret_opaque',
      capabilities: ['chat'],
    });
    if ('isError' in addExecution) throw new Error('tool did not resolve');
    const addResult = await addExecution.execute(context);
    expect(createInput).toMatchObject({ secret_ref: 'secret_opaque' });
    expect(String(addResult.output)).not.toContain('secret_opaque');

    const describeExecution = tool.resolveExecution({
      operation: 'describe_model',
      connection_id: 'connection_anthropic',
      model: 'claude-test',
    });
    if ('isError' in describeExecution) throw new Error('tool did not resolve');
    const describeResult = await describeExecution.execute(context);
    expect(String(describeResult.output)).toContain('tool_use');
    expect(String(describeResult.output)).not.toContain('x-safe-header');
  });

  it('projects a training result into the existing Run transcript', async () => {
    const ml = {
      startTraining: async () => ({
        id: 'training_test',
        workspace_id: 'wd_test_0123456789ab',
        experiment_id: 'experiment_test',
        run_id: 'run_test',
        status: 'succeeded' as const,
        executor: 'local' as const,
        dataset_artifact_id: 'artifact_dataset',
        metrics: { accuracy: 1 },
        checkpoint_artifact_ids: ['artifact_checkpoint'],
        model_artifact_id: 'artifact_model',
        created_at: '2026-08-08T00:00:00.000Z',
        started_at: '2026-08-08T00:00:00.000Z',
        completed_at: '2026-08-08T00:00:00.000Z',
      }),
      getTrainingRun: async () => undefined,
    } as unknown as IWorkspaceMlService;
    const artifacts = {
      get: async (id: string) => ({
        id,
        workspace_id: 'wd_test_0123456789ab',
        name: `${id}.json`,
        kind: (id === 'artifact_model' ? 'model' : 'bundle') as 'model' | 'bundle',
        version: 1,
        content_ref: `${id}_blob`,
        size_bytes: 128,
        sha256: `${id}_hash`,
        created_at: '2026-08-08T00:00:00.000Z',
      }),
    } as unknown as IWorkspaceArtifactService;
    const tool = new MlTool(ml, runs(), artifacts);
    const execution = tool.resolveExecution({ operation: 'train', experiment_id: 'experiment_test' });
    if ('isError' in execution) throw new Error('tool did not resolve');

    const result = await execution.execute(context);

    expect(result).toMatchObject({ isError: false });
    expect(String(result.output)).toContain('training_test');
    expect(String(result.output)).toContain('artifact_model');
    expect(String(result.output)).toContain('run_test');
  });

  it('runs the complete local dataset-to-model workflow as one root-linked operation', async () => {
    const dataset = {
      id: 'dataset_sales',
      workspace_id: 'wd_test_0123456789ab',
      name: 'sales',
      format: 'csv' as const,
      current_version: 1,
      versions: [{
        version: 1,
        artifact_id: 'artifact_dataset',
        row_count: 4,
        columns: [
          { name: 'tenure', type: 'number' as const, nullable: false, non_null_count: 4, distinct_count: 4 },
          { name: 'churned', type: 'string' as const, nullable: false, non_null_count: 4, distinct_count: 2 },
        ],
        created_at: '2026-08-08T00:00:00.000Z',
      }],
      created_at: '2026-08-08T00:00:00.000Z',
      updated_at: '2026-08-08T00:00:00.000Z',
    };
    const datasets = {
      get: async () => dataset,
      profile: async () => ({
        dataset_id: 'dataset_sales',
        version: 1,
        row_count: 4,
        columns: dataset.versions[0]!.columns,
        artifact_id: 'artifact_profile',
        generated_at: '2026-08-08T00:00:00.000Z',
      }),
    } as unknown as IWorkspaceDatasetService;
    const ml = {
      analyze: async () => ({
        id: 'analysis_sales',
        workspace_id: 'wd_test_0123456789ab',
        run_id: 'run_test',
        dataset_id: 'dataset_sales',
        dataset_version: 1,
        dataset_artifact_id: 'artifact_dataset',
        kind: 'visualization' as const,
        row_count: 4,
        column_count: 2,
        report_artifact_id: 'artifact_report',
        visualization_artifact_ids: ['artifact_chart'],
        input_digest: 'a'.repeat(64),
        created_at: '2026-08-08T00:00:00.000Z',
      }),
      createExperiment: async () => ({
        id: 'experiment_sales',
        workspace_id: 'wd_test_0123456789ab',
        name: 'sales baseline',
        dataset_id: 'dataset_sales',
        dataset_version: 1,
        dataset_artifact_id: 'artifact_dataset',
        target: 'churned',
        features: ['tenure'],
        task: 'classification' as const,
        algorithm: 'nearest_centroid',
        metrics: [{ name: 'accuracy', higher_is_better: true }],
        hyperparameters: {},
        seed: 0,
        state: 'ready' as const,
        run_ids: ['run_test'],
        training_run_ids: [],
        model_version_ids: [],
        latest_run_id: 'run_test',
        created_at: '2026-08-08T00:00:00.000Z',
        updated_at: '2026-08-08T00:00:00.000Z',
      }),
      startTraining: async () => ({
        id: 'training_sales',
        workspace_id: 'wd_test_0123456789ab',
        experiment_id: 'experiment_sales',
        run_id: 'run_test',
        status: 'succeeded' as const,
        executor: 'local' as const,
        dataset_artifact_id: 'artifact_dataset',
        metrics: { accuracy: 0.75 },
        checkpoint_artifact_ids: ['artifact_checkpoint'],
        model_artifact_id: 'artifact_model',
        created_at: '2026-08-08T00:00:00.000Z',
        started_at: '2026-08-08T00:00:00.000Z',
        completed_at: '2026-08-08T00:00:00.000Z',
      }),
      evaluate: async () => ({
        id: 'evaluation_sales',
        workspace_id: 'wd_test_0123456789ab',
        experiment_id: 'experiment_sales',
        run_id: 'run_test',
        dataset_artifact_id: 'artifact_dataset',
        candidate_model_artifact_id: 'artifact_model',
        benchmark_id: 'dataset_holdout',
        benchmark_version: 1,
        sample_size: 4,
        input_digest: 'b'.repeat(64),
        metrics: [{ name: 'accuracy', candidate: 0.75, passed: true }],
        recommendation: 'investigate' as const,
        artifact_id: 'artifact_evaluation',
        limitations: [],
        created_at: '2026-08-08T00:00:00.000Z',
      }),
      registerModel: async () => ({
        id: 'model_sales',
        workspace_id: 'wd_test_0123456789ab',
        model_name: 'sales-baseline',
        version: 1,
        stage: 'candidate' as const,
        artifact_id: 'artifact_model',
        experiment_id: 'experiment_sales',
        training_run_id: 'training_sales',
        evaluation_id: 'evaluation_sales',
        metrics: { accuracy: 0.75 },
        lineage_artifact_ids: ['artifact_dataset', 'artifact_checkpoint', 'artifact_model'],
        created_at: '2026-08-08T00:00:00.000Z',
        updated_at: '2026-08-08T00:00:00.000Z',
      }),
    } as unknown as IWorkspaceMlService;
    const artifacts = {
      get: async (id: string) => ({
        id,
        workspace_id: 'wd_test_0123456789ab',
        name: `${id}.json`,
        kind: 'metrics' as const,
        version: 1,
        content_ref: `${id}_blob`,
        size_bytes: 128,
        sha256: 'c'.repeat(64),
        created_at: '2026-08-08T00:00:00.000Z',
      }),
    } as unknown as IWorkspaceArtifactService;
    const service = runs();
    let createInput: unknown;
    const originalCreate = service.create;
    service.create = async (input) => {
      createInput = input;
      return originalCreate(input);
    };
    const conversation = {
      root: async () => ({ id: 'run_conversation_root' }),
    } as unknown as IPlatformConversationService;
    const tool = new MlTool(ml, service, artifacts, conversation, undefined, datasets);
    const execution = tool.resolveExecution({
      operation: 'baseline_workflow',
      dataset_id: 'dataset_sales',
      target: 'churned',
      features: ['tenure'],
      task: 'classification',
    });
    if ('isError' in execution) throw new Error('tool did not resolve');

    const result = await execution.execute(context);

    expect(result).toMatchObject({ isError: false });
    expect(String(result.output)).toContain('artifact_chart');
    expect(String(result.output)).toContain('model_sales');
    expect(createInput).toMatchObject({ parent_run_id: 'run_conversation_root' });
  });

  it('creates native pipeline definitions without adding a second command surface', async () => {
    const pipelines = {
      create: async (input: { name: string }) => ({
        id: 'pipeline_test',
        workspace_id: 'wd_test_0123456789ab',
        name: input.name,
        steps: [{ id: 'analysis', name: 'Analyze', kind: 'analysis' as const, config: { dataset_id: 'dataset_sales' }, depends_on: [] }],
        state: 'ready' as const,
        run_ids: [],
        pipeline_run_ids: [],
        created_at: '2026-08-08T00:00:00.000Z',
        updated_at: '2026-08-08T00:00:00.000Z',
      }),
    } as unknown as IWorkspacePipelineService;
    const tool = new PipelineTool(pipelines, runs());
    const execution = tool.resolveExecution({
      operation: 'create',
      name: 'daily analysis',
      steps: [{ id: 'analysis', name: 'Analyze', kind: 'analysis', config: { dataset_id: 'dataset_sales' } }],
    });
    if ('isError' in execution) throw new Error('tool did not resolve');

    const result = await execution.execute(context);

    expect(result).toMatchObject({ isError: false });
    expect(String(result.output)).toContain('pipeline_test');
  });

  it('projects execution targets without exposing credential references', async () => {
    const targets = {
      list: async () => [{
        id: 'target_customer',
        workspace_id: 'wd_test_0123456789ab',
        name: 'customer worker',
        type: 'customer-managed' as const,
        state: 'ready' as const,
        locality: 'customer-region' as const,
        region: 'us-east-1',
        capabilities: ['training'],
        credential_ref: 'secret_worker_should_not_leave_tool_output',
        lease_ref: 'lease_ref_worker',
        created_at: '2026-08-08T00:00:00.000Z',
        updated_at: '2026-08-08T00:00:00.000Z',
      }],
    } as unknown as IWorkspaceExecutionTargetService;
    const tool = new ExecutionTargetTool(targets);
    const execution = tool.resolveExecution({ operation: 'list' });
    if ('isError' in execution) throw new Error('tool did not resolve');

    const result = await execution.execute(context);

    expect(result).toMatchObject({ isError: false });
    expect(String(result.output)).toContain('credential_configured');
    expect(String(result.output)).not.toContain('secret_worker_should_not_leave_tool_output');
  });

  it('routes a remote lease approval through the existing session interaction', async () => {
    let acquireCount = 0;
    const targets = {
      acquireLease: async (_targetId: string, input: { readonly policy_decision_id?: string }) => {
        acquireCount += 1;
        return {
          id: `lease_${acquireCount}`,
          state: acquireCount === 1 ? 'awaiting_approval' as const : 'active' as const,
          policy_decision_id: input.policy_decision_id ?? 'policy_target',
        };
      },
    } as unknown as IWorkspaceExecutionTargetService;
    const approvals = {
      request: async (input: { readonly policyDecisionId: string; readonly action: string }) => {
        expect(input.policyDecisionId).toBe('policy_target');
        expect(input.action).toBe('Use execution target target_customer');
        return { decision: 'approved' as const, policyDecisionId: input.policyDecisionId };
      },
    } as unknown as IPlatformApprovalService;
    const tool = new ExecutionTargetTool(targets, approvals);
    const execution = tool.resolveExecution({
      operation: 'acquire_lease',
      target_id: 'target_customer',
      run_id: 'run_test',
      duration_seconds: 900,
    });
    if ('isError' in execution) throw new Error('tool did not resolve');

    const result = await execution.execute(context);

    expect(result).toMatchObject({ isError: false });
    expect(String(result.output)).toContain('lease_2');
    expect(String(result.output)).toContain('approval_required');
    expect(acquireCount).toBe(2);
  });
});

const connectionForToolTest = {
  id: 'connection_test',
  workspace_id: 'wd_test_0123456789ab',
  name: 'Test',
  provider: 'openai' as const,
  scope: 'workspace' as const,
  state: 'configured' as const,
  secret_ref: 'secret_test',
  capabilities: ['chat'],
  created_at: '2026-08-08T00:00:00.000Z',
  updated_at: '2026-08-08T00:00:00.000Z',
};
