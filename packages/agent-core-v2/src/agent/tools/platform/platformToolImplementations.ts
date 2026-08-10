/**
 * Agent-facing adapters for the workspace platform contracts.
 *
 * The tools do not know about persistence, files, HTTP routes, or provider
 * secrets.  They resolve the existing scoped service contracts and project
 * their results into concise model-readable text.  Meaningful data/provider
 * work gets a durable session Run before the service call, so a transcript is
 * only a projection of the authoritative Run and artifact records.
 */

import {
  artifactKindSchema,
  type Artifact,
  type Analysis,
  type DatasetCreateInput,
  type DatasetVersionCreateInput,
  type DatasetQueryResult,
  type ExecutionTarget,
  type Evaluation,
  type Experiment,
  type ExperimentComparison,
  type ModelVersion,
  type ProviderConnection,
  type ResourceType,
  type Run,
  type TrainingRun,
} from '@moonshot-ai/protocol';

import { toInputJsonSchema } from '#/tool/input-schema';
import {
  ref,
  type LiveRef,
  type ServiceIdentifier,
  type ServicesAccessor,
} from '#/_base/di/instantiation';
import type {
  ExecutableToolContext,
  ExecutableToolResult,
  ToolExecution,
} from '#/tool/toolContract';
import { registerAgentToolService } from '#/agent/toolRegistry/toolContribution';
import { ISessionRunService } from '#/session/run/run';
import { isError2 } from '#/_base/errors/errors';
import { IFlagService } from '#/app/flag/flag';
import { IWorkspaceArtifactService } from '#/workspace/artifacts/artifact';
import { IWorkspaceDatasetService } from '#/workspace/datasets/dataset';
import { IWorkspacePolicyService } from '#/workspace/policy/policy';
import { IWorkspaceProviderConnectionService } from '#/workspace/providerConnections/providerConnection';
import { IWorkspaceProviderRuntimeService } from '#/workspace/providerConnections/providerRuntime';
import { IWorkspaceResourceService } from '#/workspace/resources/resource';
import { IWorkspaceAutomationService } from '#/workspace/automations/automation';
import { IWorkspaceMlService } from '#/workspace/ml/ml';
import { IWorkspacePipelineService } from '#/workspace/pipelines/pipeline';
import { IWorkspaceExecutionService } from '#/workspace/execution/execution';
import { IWorkspaceExecutionTargetService } from '#/workspace/executionTargets/executionTarget';
import { IWorkspaceServingService } from '#/workspace/serving/serving';
import { IPlatformModelBindingService } from '#/agent/platformModelBinding/platformModelBinding';
import {
  IPlatformRunReplayService,
  platformRunOperationMetadata,
} from '#/agent/platformRunReplay/platformRunReplay';
import { IPlatformConversationService } from '#/agent/platformConversation/platformConversation';
import { IPlatformApprovalService } from '#/agent/platformApproval/platformApproval';
import {
  baselineWorkflowProjection,
  executeBaselineWorkflow,
  type BaselineWorkflowResult,
} from './baselineWorkflow';

import {
  ArtifactToolInputSchema,
  DatasetToolInputSchema,
  GovernanceToolInputSchema,
  IArtifactTool,
  IDatasetTool,
  IGovernanceTool,
  IProviderTool,
  IResourceTool,
  IRunTool,
  IAutomationTool,
  IMlTool,
  IPipelineTool,
  IServingTool,
  IExecutionTargetTool,
  AutomationToolInputSchema,
  MlToolInputSchema,
  PipelineToolInputSchema,
  ServingToolInputSchema,
  ExecutionTargetToolInputSchema,
  ProviderToolInputSchema,
  ResourceToolInputSchema,
  RunToolInputSchema,
  type ArtifactToolInput,
  type DatasetToolInput,
  type GovernanceToolInput,
  type ProviderToolInput,
  type ResourceToolInput,
  type RunToolInput,
  type AutomationToolInput,
  type MlToolInput,
  type PipelineToolInput,
  type ServingToolInput,
  type ExecutionTargetToolInput,
} from './platformTools';

const PLATFORM_TOOL_APPROVAL = 'platform_services';
const MAX_TRANSCRIPT_ROWS = 50;
const MAX_TRANSCRIPT_BYTES = 24_000;

function requestId(toolCallId: string, suffix: string): string {
  return `platform:${toolCallId}:${suffix}`;
}

function json(value: unknown): string {
  const encoded = JSON.stringify(value, null, 2);
  return encoded.length <= MAX_TRANSCRIPT_BYTES
    ? encoded
    : `${encoded.slice(0, MAX_TRANSCRIPT_BYTES)}\n…(truncated; inspect the Run or artifact for the full result)`;
}

function errorText(error: unknown): string {
  if (isError2(error)) {
    const details = error.details === undefined ? '' : ` ${JSON.stringify(error.details)}`;
    return `${error.message}${details}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function replaySafeInput(input: object): Readonly<Record<string, unknown>> {
  const { metadata: _metadata, ...rest } = input as Record<string, unknown>;
  return rest;
}

function detailString(error: unknown, key: string): string | undefined {
  if (!isError2(error)) return undefined;
  const value = error.details?.[key];
  return typeof value === 'string' ? value : undefined;
}

function runRef(run: Run): { id: string; status: Run['status'] } {
  return { id: run.id, status: run.status };
}

function progress(ctx: ExecutableToolContext, text: string): void {
  ctx.onUpdate?.({ kind: 'status', text });
}

function artifactRef(artifact: Artifact): { id: string; version: number } {
  // Run output_artifacts are intentionally compact protocol references. The
  // transcript can resolve the display name/kind through the artifact facade.
  return { id: artifact.id, version: artifact.version };
}

function redactConnection(connection: ProviderConnection): Record<string, unknown> {
  const { secret_ref: _secretRef, ...publicConnection } = connection;
  return { ...publicConnection, secret_configured: true };
}

function providerValidationSummary(result: {
  readonly connection_id: string;
  readonly model: string;
  readonly ok: boolean;
  readonly duration_ms: number;
  readonly text?: string;
  readonly policy_decision_id?: string;
  readonly error?: string;
  readonly usage?: unknown;
}): Record<string, unknown> {
  // Token counters remain in the commercial usage record; they are not part
  // of the default transcript projection.
  return {
    connection_id: result.connection_id,
    model: result.model,
    ok: result.ok,
    duration_ms: result.duration_ms,
    text: result.text,
    policy_decision_id: result.policy_decision_id,
    error: result.error,
    usage_recorded: result.usage !== undefined,
  };
}

type ArtifactServiceRef = LiveRef<IWorkspaceArtifactService> | IWorkspaceArtifactService;

function currentArtifactService(
  service: ArtifactServiceRef,
): IWorkspaceArtifactService | undefined {
  return 'current' in service ? service.current : service;
}

async function createRun(
  runs: ISessionRunService,
  ctx: ExecutableToolContext,
  kind: string,
  metadata?: Readonly<Record<string, unknown>>,
  executionTargetId?: string,
  conversation?: IPlatformConversationService,
): Promise<Run> {
  progress(ctx, 'Creating durable Run…');
  const root = conversation === undefined || typeof conversation.root !== 'function'
    ? undefined
    : await conversation.root();
  const run = await runs.create({
    request_id: requestId(ctx.toolCallId, `${kind}:create`),
    parent_run_id: root?.id,
    execution_target_id: executionTargetId,
    metadata: { kind, tool: 'kimi-platform', ...metadata, required: true },
  });
  await runs.transition(run.id, {
    request_id: requestId(ctx.toolCallId, `${kind}:planning`),
    status: 'planning',
  });
  progress(ctx, 'Run planned…');
  await runs.transition(run.id, {
    request_id: requestId(ctx.toolCallId, `${kind}:running`),
    status: 'running',
  });
  progress(ctx, 'Run started…');
  return (await runs.get(run.id)) ?? run;
}

async function completeRun(
  runs: ISessionRunService,
  ctx: ExecutableToolContext,
  run: Run,
  outputArtifacts: readonly Artifact[] = [],
  metadata?: Readonly<Record<string, unknown>>,
): Promise<Run | undefined> {
  progress(ctx, 'Run completed; recording artifacts…');
  return runs.transition(run.id, {
    request_id: requestId(ctx.toolCallId, `${run.id}:succeeded`),
    status: 'succeeded',
    output_artifacts: outputArtifacts.map(artifactRef),
    metadata,
  });
}

async function failRun(
  runs: ISessionRunService,
  ctx: ExecutableToolContext,
  run: Run,
  error: unknown,
): Promise<void> {
  progress(ctx, 'Run failed; recording the failure…');
  try {
    await runs.transition(run.id, {
      request_id: requestId(ctx.toolCallId, `${run.id}:failed`),
      status: 'failed',
      status_reason: errorText(error).slice(0, 2_000),
    });
  } catch {
    // The original operation is the useful model-facing failure.  A second
    // persistence error must not hide it.
  }
}

async function awaitApprovalRun(
  runs: ISessionRunService,
  ctx: ExecutableToolContext,
  run: Run,
  error: unknown,
  policyDecisionIdOverride?: string,
  approvals?: IPlatformApprovalService,
  action = 'platform operation',
): Promise<Run | undefined> {
  progress(ctx, 'Approval required; Run is waiting for a decision…');
  const decisionId = policyDecisionIdOverride ?? detailString(error, 'policyDecisionId');
  const policyDecisionIds = decisionId === undefined
    ? undefined
    : [...new Set([...(run.policy_decision_ids ?? []), decisionId])];
  try {
    const awaiting = await runs.transition(run.id, {
      request_id: requestId(ctx.toolCallId, `${run.id}:approval`),
      status: 'awaiting_approval',
      status_reason: errorText(error).slice(0, 2_000),
      policy_decision_ids: policyDecisionIds,
      metadata: decisionId === undefined ? undefined : { policy_decision_id: decisionId },
    });
    if (awaiting === undefined || decisionId === undefined || approvals === undefined) return awaiting;

    const result = await approvals.request({
      runId: run.id,
      policyDecisionId: decisionId,
      toolName: 'Platform',
      action,
      context: ctx,
    });
    if (result === undefined) return awaiting;
    if (result.decision === 'approved') {
      return await runs.transition(run.id, {
        request_id: requestId(ctx.toolCallId, `${run.id}:approval-approved`),
        status: 'running',
        status_reason: 'Platform policy approval granted; resume this Run to continue.',
        metadata: {
          platform_approval: 'approved',
          policy_decision_id: result.policyDecisionId,
        },
      });
    }
    return await runs.transition(run.id, {
      request_id: requestId(ctx.toolCallId, `${run.id}:approval-denied`),
      status: 'cancelled',
      status_reason: result.feedback ?? 'Platform policy approval denied by the user.',
      metadata: {
        platform_approval: result.decision,
        policy_decision_id: result.policyDecisionId,
      },
    });
  } catch {
    return undefined;
  }
}

function success(output: unknown): ExecutableToolResult {
  return { output: typeof output === 'string' ? output : json(output), isError: false };
}

function failure(message: string): ExecutableToolResult {
  return { output: message, isError: true };
}

function approvalProjection(
  run: Run,
  pendingMessage: string,
): { readonly approval_required: boolean; readonly message: string } {
  const approval = run.metadata?.['platform_approval'];
  if (approval === 'approved') {
    return {
      approval_required: false,
      message: 'Approval recorded; resume this Run to continue the platform operation.',
    };
  }
  if (approval === 'rejected' || approval === 'cancelled') {
    return {
      approval_required: false,
      message: 'Platform approval was denied; the Run was cancelled.',
    };
  }
  return { approval_required: run.status === 'awaiting_approval', message: pendingMessage };
}

function platformWhen(accessor: ServicesAccessor): boolean {
  if (!accessor.get(IFlagService).enabled('platform_services')) return false;
  // The master experimental switch is also used by isolated Kimi tests and
  // plugin hosts. Do not activate platform tools there unless the complete
  // platform service graph is registered; `has` is a non-materializing probe
  // and therefore remains safe for OnDemand workspace services.
  if (accessor.has === undefined) return false;
  const hasService = (id: ServiceIdentifier<unknown>): boolean => accessor.has?.(id) === true;
  const required: readonly ServiceIdentifier<unknown>[] = [
    IWorkspaceDatasetService,
    ISessionRunService,
    IWorkspaceArtifactService,
    IWorkspaceProviderConnectionService,
    IWorkspaceProviderRuntimeService,
    IWorkspacePolicyService,
    IWorkspaceResourceService,
    IWorkspaceAutomationService,
    IWorkspaceMlService,
    IWorkspacePipelineService,
    IWorkspaceExecutionService,
    IWorkspaceExecutionTargetService,
    IWorkspaceServingService,
    IPlatformModelBindingService,
    IPlatformRunReplayService,
    IPlatformConversationService,
    IPlatformApprovalService,
  ];
  return required.every(hasService);
}

export class DatasetTool implements IDatasetTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'Dataset' as const;
  readonly description =
    'Use native dataset operations for structured local data. List or inspect datasets, register CSV or JSONL, profile them, or run read-only SQL. Meaningful operations create a durable Run and return artifact references.';
  readonly parameters = toInputJsonSchema(DatasetToolInputSchema);

  constructor(
    @IWorkspaceDatasetService private readonly datasets: IWorkspaceDatasetService,
    @ISessionRunService private readonly runs: ISessionRunService,
    @ref(IWorkspaceArtifactService) private readonly artifacts: ArtifactServiceRef,
    @IPlatformConversationService private readonly conversation?: IPlatformConversationService,
    @IPlatformApprovalService private readonly approvals?: IPlatformApprovalService,
  ) {}

  resolveExecution(args: DatasetToolInput): ToolExecution {
    return {
      description: `Dataset ${args.operation}`,
      approvalRule: PLATFORM_TOOL_APPROVAL,
      execute: (ctx) => this.execute(args, ctx),
    };
  }

  private async execute(args: DatasetToolInput, ctx: ExecutableToolContext): Promise<ExecutableToolResult> {
    try {
      if (args.operation === 'list') return success(await this.datasets.list());
      const datasetReference = 'dataset_id' in args ? args.dataset_id : undefined;
      const datasetId = await this.resolveDatasetId(datasetReference);
      if (args.operation !== 'register' && datasetId === undefined) {
        return failure(`Dataset not found: ${datasetReference ?? 'current'}`);
      }
      const requiredDatasetId = datasetId as string;
      if (args.operation === 'inspect') return success(await this.datasets.get(requiredDatasetId));

      const kind = args.operation === 'register'
        ? 'dataset_analysis'
        : `dataset_${args.operation}`;
      const run = await createRun(this.runs, ctx, kind, {
        dataset_id: 'dataset_id' in args ? datasetId : undefined,
        platform_operation: args.operation === 'profile' || args.operation === 'query' || args.operation === 'transform'
          ? platformRunOperationMetadata('dataset', { ...args, dataset_id: datasetId })['platform_operation']
          : undefined,
      }, undefined, this.conversation);
      try {
        if (args.operation === 'register') {
          const input: DatasetCreateInput = {
            request_id: requestId(ctx.toolCallId, 'dataset:create'),
            name: args.name,
            format: args.format ?? 'csv',
            source_path: args.source_path,
            content_base64: args.content_base64,
            run_id: run.id,
            policy_decision_id: args.policy_decision_id,
            metadata: args.metadata,
          };
          const dataset = await this.datasets.create(input);
          const source = dataset.versions.find((version) => version.version === dataset.current_version);
          const artifactService = currentArtifactService(this.artifacts);
          const artifact = source === undefined || artifactService === undefined
            ? undefined
            : await artifactService.get(source.artifact_id);
          const finished = await completeRun(
            this.runs,
            ctx,
            run,
            artifact === undefined ? [] : [artifact],
          );
          return success({ run: runRef(finished ?? run), dataset });
        }
        if (args.operation === 'version') {
          const input: DatasetVersionCreateInput = {
            request_id: requestId(ctx.toolCallId, 'dataset:version'),
            source_path: args.source_path,
            content_base64: args.content_base64,
            run_id: run.id,
            policy_decision_id: args.policy_decision_id,
            metadata: args.metadata,
          };
          const dataset = await this.datasets.createVersion(requiredDatasetId, input);
          if (dataset === undefined) {
            await failRun(this.runs, ctx, run, new Error(`dataset not found: ${requiredDatasetId}`));
            return failure(`Dataset not found: ${requiredDatasetId}`);
          }
          const source = dataset.versions.find((version) => version.version === dataset.current_version);
          const artifactService = currentArtifactService(this.artifacts);
          const artifact = source === undefined || artifactService === undefined
            ? undefined
            : await artifactService.get(source.artifact_id);
          const finished = await completeRun(
            this.runs,
            ctx,
            run,
            artifact === undefined ? [] : [artifact],
          );
          return success({ run: runRef(finished ?? run), dataset });
        }
        if (args.operation === 'transform') {
          const dataset = await this.datasets.transform(requiredDatasetId, {
            request_id: requestId(ctx.toolCallId, 'dataset:transform'),
            run_id: run.id,
            sql: args.sql,
            version: args.version,
            max_rows: args.max_rows,
            policy_decision_id: args.policy_decision_id,
            metadata: args.metadata,
          });
          if (dataset === undefined) {
            await failRun(this.runs, ctx, run, new Error(`Dataset not found: ${requiredDatasetId}`));
            return failure(`Dataset not found: ${requiredDatasetId}`);
          }
          const source = dataset.versions.find((version) => version.version === dataset.current_version);
          const artifactService = currentArtifactService(this.artifacts);
          const artifact = source === undefined || artifactService === undefined
            ? undefined
            : await artifactService.get(source.artifact_id);
          const finished = await completeRun(
            this.runs,
            ctx,
            run,
            artifact === undefined ? [] : [artifact],
          );
          return success({ run: runRef(finished ?? run), dataset });
        }
        if (args.operation === 'profile') {
          const profile = await this.datasets.profile(requiredDatasetId, {
            request_id: requestId(ctx.toolCallId, 'dataset:profile'),
            run_id: run.id,
            version: args.version,
            policy_decision_id: args.policy_decision_id,
          });
          if (profile === undefined) {
            await failRun(this.runs, ctx, run, new Error(`dataset not found: ${requiredDatasetId}`));
            return failure(`Dataset not found: ${requiredDatasetId}`);
          }
          const artifactService = currentArtifactService(this.artifacts);
          if (artifactService === undefined) {
            await failRun(this.runs, ctx, run, new Error('Dataset artifacts are unavailable in this session.'));
            return failure('Dataset artifacts are unavailable in this session.');
          }
          const artifact = await artifactService.get(profile.artifact_id);
          const finished = await completeRun(this.runs, ctx, run, artifact === undefined ? [] : [artifact]);
          return success({ run: runRef(finished ?? run), profile });
        }
        const result = await this.datasets.query(requiredDatasetId, {
          request_id: requestId(ctx.toolCallId, 'dataset:query'),
          run_id: run.id,
          sql: args.sql,
          version: args.version,
          max_rows: args.max_rows,
          policy_decision_id: args.policy_decision_id,
        });
        if (result === undefined) {
          await failRun(this.runs, ctx, run, new Error(`dataset not found: ${requiredDatasetId}`));
          return failure(`Dataset not found: ${requiredDatasetId}`);
        }
        const compact = compactQueryResult(result);
        const artifactService = currentArtifactService(this.artifacts);
        if (artifactService === undefined) {
          await failRun(this.runs, ctx, run, new Error('Dataset artifacts are unavailable in this session.'));
          return failure('Dataset artifacts are unavailable in this session.');
        }
        const artifact = await artifactService.get(result.artifact_id);
        const finished = await completeRun(this.runs, ctx, run, artifact === undefined ? [] : [artifact]);
        return success({ run: runRef(finished ?? run), result: compact });
      } catch (error) {
        if (detailString(error, 'policyDecisionId') !== undefined || (isError2(error) && error.code === 'dataset.policy_required')) {
          const awaiting = await awaitApprovalRun(this.runs, ctx, run, error, undefined, this.approvals, `Dataset ${args.operation}`);
          const approval = approvalProjection(
            awaiting ?? run,
            'Approve the policy decision, then resume this Run to continue the Dataset operation.',
          );
          return success({
            run: runRef(awaiting ?? run),
            ...approval,
            policy_decision_id: detailString(error, 'policyDecisionId'),
          });
        }
        await failRun(this.runs, ctx, run, error);
        return failure(`Dataset operation failed: ${errorText(error)}`);
      }
    } catch (error) {
      return failure(`Dataset operation failed: ${errorText(error)}`);
    }
  }

  private async resolveDatasetId(reference: string | undefined): Promise<string | undefined> {
    if (reference === undefined) return undefined;
    if (this.conversation === undefined) return reference;
    return this.conversation.resolveDatasetReference(reference);
  }

}

export class RunTool implements IRunTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'Run' as const;
  readonly description =
    'Create or inspect durable platform Runs from this conversation, or cancel, resume, retry, rerun, and fork platform work. For follow-ups, run_id may be an exact id or a conversational reference such as last, latest, current, or previous. Use this for prior analysis, query, training, or evaluation work.';
  readonly parameters = toInputJsonSchema(RunToolInputSchema);

  constructor(
    @ISessionRunService private readonly runs: ISessionRunService,
    @IPlatformRunReplayService private readonly replay?: IPlatformRunReplayService,
    @IPlatformConversationService private readonly conversation?: IPlatformConversationService,
    @IPlatformApprovalService private readonly approvals?: IPlatformApprovalService,
  ) {}

  resolveExecution(args: RunToolInput): ToolExecution {
    return {
      description: `Run ${args.operation}`,
      approvalRule: PLATFORM_TOOL_APPROVAL,
      execute: (ctx) => this.execute(args, ctx),
    };
  }

  private async execute(args: RunToolInput, ctx: ExecutableToolContext): Promise<ExecutableToolResult> {
    try {
      if (args.operation === 'create') {
        const run = await this.runs.create({
          request_id: requestId(ctx.toolCallId, 'run:create'),
          plan: args.plan,
          input_resources: args.input_resources,
          execution_target_id: args.execution_target_id,
          metadata: { ...args.metadata, kind: args.kind ?? 'manual' },
        });
        return success(run);
      }
      if (args.operation === 'list') return success(await this.runs.list());
      if (args.operation === 'inspect') {
        const runId = await this.resolveRunId(args.run_id);
        if (runId === undefined) return failure(`Run not found: ${args.run_id}`);
        return success(await this.runs.get(runId));
      }
      const runId = await this.resolveRunId(args.run_id);
      if (runId === undefined) return failure(`Run not found: ${args.run_id}`);
      const actionInput = { request_id: requestId(ctx.toolCallId, `run:${args.operation}`) };
      let result: Run | undefined;
      if (args.operation === 'cancel') result = await this.runs.cancel(runId, actionInput);
      else if (args.operation === 'retry') result = await this.runs.retry(runId, actionInput);
      else if (args.operation === 'rerun') result = await this.runs.rerun(runId, actionInput);
      else if (args.operation === 'resume') result = await this.runs.resume(runId, actionInput);
      else {
        const fork = args as Extract<RunToolInput, { operation: 'fork' }>;
        result = await this.runs.fork(runId, {
          ...actionInput,
          plan: fork.plan,
          input_resources: fork.input_resources,
          execution_target_id: fork.execution_target_id,
          metadata: fork.metadata,
        });
      }
      if (result === undefined) return failure(`Run not found: ${args.run_id}`);
      if (this.replay !== undefined && args.operation !== 'cancel') {
        let replayed = await this.replay.replay(
          result.id,
          requestId(ctx.toolCallId, 'run:replay'),
        );
        if (replayed.approval_required && replayed.policy_decision_id !== undefined && this.approvals !== undefined) {
          const approval = await this.approvals.request({
            runId: replayed.run.id,
            policyDecisionId: replayed.policy_decision_id,
            toolName: 'Run',
            action: 'Resume platform Run',
            context: ctx,
          });
          if (approval?.decision === 'approved') {
            const resumed = await this.runs.resume(replayed.run.id, {
              request_id: requestId(ctx.toolCallId, 'run:approval-resume'),
              metadata: { platform_approval: 'approved' },
            });
            if (resumed !== undefined) {
              replayed = await this.replay.replay(
                resumed.id,
                requestId(ctx.toolCallId, 'run:approval-replay'),
              );
            }
          } else if (approval !== undefined) {
            await this.runs.cancel(replayed.run.id, {
              request_id: requestId(ctx.toolCallId, 'run:approval-cancel'),
              metadata: { platform_approval: approval.decision },
            });
          }
        }
        if (replayed.replayable) {
          return success({
            run: replayed.run,
            replayable: replayed.replayable,
            result: replayed.result,
            approval_required: replayed.approval_required,
            policy_decision_id: replayed.policy_decision_id,
            error: replayed.error,
          });
        }
      }
      return success(result);
    } catch (error) {
      return failure(`Run operation failed: ${errorText(error)}`);
    }
  }

  private async resolveRunId(reference: string): Promise<string | undefined> {
    if (this.conversation === undefined) return (await this.runs.get(reference))?.id;
    return (await this.conversation.resolveRunReference(reference))?.id;
  }
}

export class ProviderTool implements IProviderTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'Provider' as const;
  readonly description =
    'Inspect configured provider connections, select a governed provider/model for subsequent Kimi requests, validate a connection through its real provider boundary, or discover models. Secret material is never returned.';
  readonly parameters = toInputJsonSchema(ProviderToolInputSchema);

  constructor(
    @IWorkspaceProviderConnectionService private readonly connections: IWorkspaceProviderConnectionService,
    @IWorkspaceProviderRuntimeService private readonly runtime: IWorkspaceProviderRuntimeService,
    @ISessionRunService private readonly runs: ISessionRunService,
    @IPlatformModelBindingService private readonly binding: IPlatformModelBindingService,
    @IPlatformConversationService private readonly conversation?: IPlatformConversationService,
    @IPlatformApprovalService private readonly approvals?: IPlatformApprovalService,
  ) {}

  resolveExecution(args: ProviderToolInput): ToolExecution {
    return {
      description: `Provider ${args.operation}`,
      approvalRule: PLATFORM_TOOL_APPROVAL,
      execute: (ctx) => this.execute(args, ctx),
    };
  }

  private async execute(args: ProviderToolInput, ctx: ExecutableToolContext): Promise<ExecutableToolResult> {
    try {
      if (args.operation === 'list') {
        return success((await this.connections.list()).map(redactConnection));
      }
      if (args.operation === 'add') {
        // Agent tools may only accept an opaque reference. Raw key setup stays
        // in the secure TUI/client flow, so credentials never enter tool
        // arguments, transcripts, or model-visible results.
        const connection = await this.connections.create({
          request_id: requestId(ctx.toolCallId, 'provider:add'),
          name: args.name,
          provider: args.provider,
          scope: args.scope,
          secret_ref: args.secret_ref,
          capabilities: args.capabilities ?? [],
          metadata: args.metadata,
        });
        return success(redactConnection(connection));
      }
      if (args.operation === 'clear') {
        this.binding.clear();
        return success({
          selected: false,
          message: 'Platform provider binding cleared; subsequent Kimi requests use the configured model.',
        });
      }
      if (args.operation === 'select') {
        const selected = await this.binding.select({
          connection_id: args.connection_id,
          model: args.model,
          run_id: args.run_id,
          fallback_connection_ids: args.fallback_connection_ids,
        });
        return success({
          selected: true,
          connection_id: selected.connection_id,
          provider: selected.provider,
          model: selected.model,
          model_ref: selected.model_ref,
          model_alias: selected.model_alias,
          run_id: selected.run_id,
          fallback_connection_ids: selected.fallback_connection_ids,
          policy_decision_id: selected.policy_decision_id,
          message: 'Subsequent Kimi model requests in this agent use this governed platform connection.',
        });
      }
      if (args.operation === 'revoke') {
        const revoked = await this.runtime.revokeConnection(args.connection_id, {
          request_id: requestId(ctx.toolCallId, 'provider:revoke'),
        });
        if (revoked !== undefined && this.binding.current()?.connection_id === args.connection_id) {
          this.binding.clear();
        }
        return revoked === undefined ? failure(`Provider connection not found: ${args.connection_id}`) : success(redactConnection(revoked));
      }
      if (args.operation === 'discover_models') {
        return success(await this.runtime.discoverModels(args.connection_id, { force_remote: args.force_remote }));
      }
      if (args.operation === 'describe_model') {
        const descriptor = await this.runtime.describe(args.connection_id, args.model);
        return success({
          connection_id: descriptor.connection_id,
          provider: descriptor.provider,
          model: descriptor.model,
          protocol: descriptor.protocol,
          provider_type: descriptor.provider_type,
          base_url: descriptor.base_url,
          capabilities: descriptor.capabilities,
          max_context_size: descriptor.max_context_size,
          max_input_size: descriptor.max_input_size,
          max_output_size: descriptor.max_output_size,
          support_efforts: descriptor.support_efforts,
          default_effort: descriptor.default_effort,
        });
      }
      const run = await createRun(this.runs, ctx, 'provider_validation', {
        connection_id: args.connection_id,
        platform_operation: platformRunOperationMetadata('provider', args)['platform_operation'],
      }, undefined, this.conversation);
      try {
        const result = await this.runtime.validate(args.connection_id, args.model, {
          request_id: requestId(ctx.toolCallId, 'provider:validate'),
          run_id: run.id,
          actor: 'agent',
        });
        if (!result.ok) {
          if (result.policy_decision_id !== undefined) {
            const awaiting = await awaitApprovalRun(
              this.runs,
              ctx,
              run,
              new Error(result.error ?? 'provider model policy approval is required'),
              result.policy_decision_id,
              this.approvals,
              `Validate ${result.model}`,
            );
            const approval = approvalProjection(
              awaiting ?? run,
              'Approve the provider policy decision, then resume this Run to continue validation.',
            );
            return success({
              run: runRef(awaiting ?? run),
              validation: providerValidationSummary(result),
              ...approval,
            });
          }
          await failRun(this.runs, ctx, run, new Error(result.error ?? 'provider validation failed'));
          return failure(`Provider validation failed: ${result.error ?? 'provider rejected the request'}`);
        }
        // Runtime validation is deliberately read-only with respect to the
        // provider registry. Mark the connection validated only after the
        // real provider boundary has accepted the probe.
        const validated = await this.connections.validate(args.connection_id, {
          request_id: requestId(ctx.toolCallId, 'provider:validated'),
        });
        const finished = await completeRun(this.runs, ctx, run, [], {
          provider_connection_id: args.connection_id,
          model: result.model,
          usage_recorded: result.usage !== undefined,
          policy_decision_id: result.policy_decision_id,
          ok: result.ok,
          duration_ms: result.duration_ms,
          connection_state: validated?.state,
        });
        return success({ run: runRef(finished ?? run), validation: providerValidationSummary(result) });
      } catch (error) {
        await failRun(this.runs, ctx, run, error);
        return failure(`Provider validation failed: ${errorText(error)}`);
      }
    } catch (error) {
      return failure(`Provider operation failed: ${errorText(error)}`);
    }
  }
}

export class ArtifactTool implements IArtifactTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'Artifact' as const;
  readonly description =
    'Inspect generated reports, tables, metrics, charts, and other content-addressed artifacts. Use from_run with a Run id or last/current reference to retrieve its outputs, and use lineage to trace datasets and Runs. Downloads are summarized unless explicitly requested for a small artifact.';
  readonly parameters = toInputJsonSchema(ArtifactToolInputSchema);

  constructor(
    @ref(IWorkspaceArtifactService) private readonly artifacts: ArtifactServiceRef,
    @ISessionRunService private readonly runs?: ISessionRunService,
    @IPlatformConversationService private readonly conversation?: IPlatformConversationService,
  ) {}

  resolveExecution(args: ArtifactToolInput): ToolExecution {
    return {
      description: `Artifact ${args.operation}`,
      approvalRule: PLATFORM_TOOL_APPROVAL,
      execute: () => this.execute(args),
    };
  }

  private async execute(args: ArtifactToolInput): Promise<ExecutableToolResult> {
    try {
      const artifactService = currentArtifactService(this.artifacts);
      if (artifactService === undefined) return failure('Artifacts are unavailable in this session.');
      if (args.operation === 'list') {
        const kind = args.kind === undefined ? undefined : artifactKindSchema.parse(args.kind);
        return success(await artifactService.list(kind));
      }
      if (args.operation === 'from_run') {
        const run = await this.resolveRun(args.run_id);
        if (run === undefined) return failure(`Run not found: ${args.run_id}`);
        const artifacts = [];
        for (const ref of run.output_artifacts ?? []) {
          const artifact = await artifactService.get(ref.id);
          if (artifact !== undefined) artifacts.push(artifact);
        }
        return success({ run: { id: run.id, status: run.status }, artifacts });
      }
      if (args.operation === 'inspect') return success(await artifactService.get(args.artifact_id));
      if (args.operation === 'lineage') return success(await artifactService.lineage(args.artifact_id));
      const downloaded = await artifactService.download(args.artifact_id);
      if (downloaded === undefined) return failure(`Artifact not found: ${args.artifact_id}`);
      const bytes = Buffer.from(downloaded.content_base64, 'base64');
      return success({
        artifact: downloaded.artifact,
        size_bytes: bytes.byteLength,
        content_available: true,
        content_base64:
          args.include_content === true && bytes.byteLength <= 32 * 1024
            ? downloaded.content_base64
            : undefined,
        message:
          args.include_content === true && bytes.byteLength > 32 * 1024
            ? 'Artifact is larger than the transcript download limit; use the client artifact download surface.'
            : undefined,
      });
    } catch (error) {
      return failure(`Artifact operation failed: ${errorText(error)}`);
    }
  }

  private async resolveRun(reference: string): Promise<Run | undefined> {
    if (this.conversation !== undefined) return this.conversation.resolveRunReference(reference);
    return this.runs?.get(reference);
  }
}

export class GovernanceTool implements IGovernanceTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'Governance' as const;
  readonly description =
    'Explain and resolve workspace policy decisions governing provider, dataset, cloud, and serving actions. Use approve or deny only when the user explicitly directs it.';
  readonly parameters = toInputJsonSchema(GovernanceToolInputSchema);

  constructor(@IWorkspacePolicyService private readonly policy: IWorkspacePolicyService) {}

  resolveExecution(args: GovernanceToolInput): ToolExecution {
    return {
      description: `Governance ${args.operation}`,
      approvalRule: PLATFORM_TOOL_APPROVAL,
      execute: (ctx) => this.execute(args, ctx),
    };
  }

  private async execute(args: GovernanceToolInput, ctx: ExecutableToolContext): Promise<ExecutableToolResult> {
    try {
      if (args.operation === 'list') return success(await this.policy.list());
      if (args.operation === 'pending') {
        const decisions = await this.policy.list();
        return success(decisions.filter((decision) =>
          decision.state === 'evaluated' && decision.outcome === 'approval_required',
        ));
      }
      if (args.operation === 'explain') return success(await this.policy.explain(args.decision_id));
      if (args.operation === 'evaluate') {
        return success(await this.policy.evaluate({
          request_id: requestId(ctx.toolCallId, 'policy:evaluate'),
          run_id: args.run_id,
          capability: args.capability,
          action: args.action,
          requested_by: 'agent',
        }));
      }
      const input = {
        request_id: requestId(ctx.toolCallId, `policy:${args.operation}`),
        decided_by: 'user' as const,
        reason: args.reason,
      };
      const decision = args.operation === 'approve'
        ? await this.policy.approve(args.decision_id, input)
        : await this.policy.deny(args.decision_id, input);
      return decision === undefined ? failure(`Policy decision not found: ${args.decision_id}`) : success(decision);
    } catch (error) {
      return failure(`Governance operation failed: ${errorText(error)}`);
    }
  }
}

export class ResourceTool implements IResourceTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'Resource' as const;
  readonly description =
    'Use workspace-native resources for datasets, tables, queries, models, experiments, notebooks, pipelines, and endpoints. Execute through the governed resource service; do not recreate resource state in the prompt.';
  readonly parameters = toInputJsonSchema(ResourceToolInputSchema);

  constructor(
    @IWorkspaceResourceService private readonly resources: IWorkspaceResourceService,
    @ISessionRunService private readonly runs: ISessionRunService,
    @IPlatformConversationService private readonly conversation?: IPlatformConversationService,
    @IPlatformApprovalService private readonly approvals?: IPlatformApprovalService,
  ) {}

  resolveExecution(args: ResourceToolInput): ToolExecution {
    return {
      description: `Resource ${args.operation}`,
      approvalRule: PLATFORM_TOOL_APPROVAL,
      execute: (ctx) => this.execute(args, ctx),
    };
  }

  private async execute(args: ResourceToolInput, ctx: ExecutableToolContext): Promise<ExecutableToolResult> {
    try {
      if (args.operation === 'list') return success(await this.resources.list(args.type as ResourceType | undefined));
      if (args.operation === 'inspect') return success(await this.resources.get(args.resource_id));
      if (args.operation === 'create') {
        return success(await this.resources.create({
          request_id: requestId(ctx.toolCallId, 'resource:create'),
          type: args.type as ResourceType,
          name: args.name,
          metadata: args.metadata,
        }));
      }
      if (args.operation === 'update') {
        return success(await this.resources.update(args.resource_id, {
          request_id: requestId(ctx.toolCallId, 'resource:update'),
          name: args.name,
          state: args.state,
          artifact_ids: args.artifact_ids,
          metadata: args.metadata,
        }));
      }
      if (args.operation === 'archive') {
        return success(await this.resources.archive(args.resource_id, {
          request_id: requestId(ctx.toolCallId, 'resource:archive'),
          state: 'archived',
        }));
      }

      const run = await createRun(this.runs, ctx, 'resource_execution', {
        resource_id: args.resource_id,
        action: args.action,
        platform_operation: platformRunOperationMetadata('resource', args)['platform_operation'],
      }, undefined, this.conversation);
      try {
        const execution = await this.resources.execute(args.resource_id, {
          request_id: requestId(ctx.toolCallId, 'resource:execute'),
          run_id: run.id,
          action: args.action,
          parameters: args.parameters,
          policy_decision_id: args.policy_decision_id,
        });
        if (execution.status === 'awaiting_approval') {
          const awaiting = await awaitApprovalRun(
            this.runs,
            ctx,
            run,
            new Error('resource execution requires policy approval'),
            execution.policy_decision_id,
            this.approvals,
            `Resource ${args.action}`,
          );
          return success({
            run: runRef(awaiting ?? run),
            execution,
            ...approvalProjection(
              awaiting ?? run,
              'Approve the policy decision, then resume this Run to continue the Resource operation.',
            ),
          });
        }
        if (execution.status === 'failed') {
          await failRun(this.runs, ctx, run, new Error(execution.error ?? 'resource execution failed'));
          return failure(JSON.stringify({ run: runRef(run), execution }));
        }
        const finished = await completeRun(this.runs, ctx, run);
        return success({ run: runRef(finished ?? run), execution });
      } catch (error) {
        await failRun(this.runs, ctx, run, error);
        return failure(`Resource execution failed: ${errorText(error)}`);
      }
    } catch (error) {
      return failure(`Resource operation failed: ${errorText(error)}`);
    }
  }
}

function redactExecutionTarget(target: ExecutionTarget): Record<string, unknown> {
  const { credential_ref: _credentialRef, ...publicTarget } = target;
  return {
    ...publicTarget,
    credential_configured: target.credential_ref !== undefined,
  };
}

export class ExecutionTargetTool implements IExecutionTargetTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'ExecutionTarget' as const;
  readonly description =
    'Discover and govern local, customer-managed, customer-cloud, and managed execution targets, including readiness and leases. Credentials remain opaque and are never returned.';
  readonly parameters = toInputJsonSchema(ExecutionTargetToolInputSchema);

  constructor(
    @IWorkspaceExecutionTargetService private readonly targets: IWorkspaceExecutionTargetService,
    @IPlatformApprovalService private readonly approvals?: IPlatformApprovalService,
  ) {}

  resolveExecution(args: ExecutionTargetToolInput): ToolExecution {
    return {
      description: `Execution target ${args.operation}`,
      approvalRule: PLATFORM_TOOL_APPROVAL,
      execute: (ctx) => this.execute(args, ctx),
    };
  }

  private async execute(
    args: ExecutionTargetToolInput,
    ctx: ExecutableToolContext,
  ): Promise<ExecutableToolResult> {
    try {
      if (args.operation === 'list') {
        return success((await this.targets.list()).map(redactExecutionTarget));
      }
      if (args.operation === 'inspect') {
        const target = await this.targets.get(args.target_id);
        return target === undefined
          ? failure(`Execution target not found: ${args.target_id}`)
          : success(redactExecutionTarget(target));
      }
      if (args.operation === 'register') {
        const target = await this.targets.register({
          request_id: requestId(ctx.toolCallId, 'execution-target:register'),
          name: args.name,
          type: args.type,
          locality: args.locality,
          region: args.region,
          capabilities: args.capabilities ?? [],
          credential_ref: args.credential_ref,
          metadata: args.metadata,
        });
        return success(redactExecutionTarget(target));
      }
      if (args.operation === 'update') {
        const target = await this.targets.update(args.target_id, {
          request_id: requestId(ctx.toolCallId, 'execution-target:update'),
          name: args.name,
          state: args.state,
          locality: args.locality,
          region: args.region,
          capabilities: args.capabilities,
          credential_ref: args.credential_ref,
          metadata: args.metadata,
        });
        return target === undefined
          ? failure(`Execution target not found: ${args.target_id}`)
          : success(redactExecutionTarget(target));
      }
      if (args.operation === 'mark_ready' || args.operation === 'disable') {
        const target = args.operation === 'mark_ready'
          ? await this.targets.markReady(args.target_id, {
            request_id: requestId(ctx.toolCallId, 'execution-target:ready'),
          })
          : await this.targets.disable(args.target_id, {
            request_id: requestId(ctx.toolCallId, 'execution-target:disable'),
          });
        return target === undefined
          ? failure(`Execution target not found: ${args.target_id}`)
          : success(redactExecutionTarget(target));
      }
      if (args.operation === 'acquire_lease') {
        const leaseRequestId = requestId(ctx.toolCallId, 'execution-target:acquire-lease');
        const lease = await this.targets.acquireLease(args.target_id, {
          request_id: leaseRequestId,
          run_id: args.run_id,
          duration_seconds: args.duration_seconds ?? 900,
          policy_decision_id: args.policy_decision_id,
        });
        if (lease.state === 'awaiting_approval' && lease.policy_decision_id !== undefined && args.run_id !== undefined && this.approvals !== undefined) {
          const approval = await this.approvals.request({
            runId: args.run_id,
            policyDecisionId: lease.policy_decision_id,
            toolName: 'ExecutionTarget',
            action: `Use execution target ${args.target_id}`,
            context: ctx,
          });
          if (approval?.decision === 'approved') {
            const approvedLease = await this.targets.acquireLease(args.target_id, {
              request_id: `${leaseRequestId}:approved`,
              run_id: args.run_id,
              duration_seconds: args.duration_seconds ?? 900,
              policy_decision_id: lease.policy_decision_id,
            });
            return success({
              lease: approvedLease,
              approval_required: false,
            });
          }
          return failure(approval?.feedback ?? 'Execution target approval was not granted.');
        }
        return success({
          lease,
          approval_required: lease.state === 'awaiting_approval',
        });
      }
      const lease = await this.targets.releaseLease(
        args.target_id,
        args.lease_id,
        { request_id: requestId(ctx.toolCallId, 'execution-target:release-lease') },
      );
      return lease === undefined
        ? failure(`Execution lease not found: ${args.lease_id}`)
        : success(lease);
    } catch (error) {
      return failure(`Execution target operation failed: ${errorText(error)}`);
    }
  }
}

export class AutomationTool implements IAutomationTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'Automation' as const;
  readonly description =
    'Create, inspect, pause, resume, and trigger durable automations. A queued automation creates the normal Kimi prompt/Run linkage and keeps approval and retry state in the platform service.';
  readonly parameters = toInputJsonSchema(AutomationToolInputSchema);

  constructor(@IWorkspaceAutomationService private readonly automations: IWorkspaceAutomationService) {}

  resolveExecution(args: AutomationToolInput): ToolExecution {
    return {
      description: `Automation ${args.operation}`,
      approvalRule: PLATFORM_TOOL_APPROVAL,
      execute: (ctx) => this.execute(args, ctx),
    };
  }

  private async execute(args: AutomationToolInput, ctx: ExecutableToolContext): Promise<ExecutableToolResult> {
    try {
      if (args.operation === 'list') return success(await this.automations.list());
      if (args.operation === 'inspect') return success(await this.automations.get(args.automation_id));
      if (args.operation === 'history') return success(await this.automations.history(args.automation_id));
      if (args.operation === 'create') {
        return success(await this.automations.create({
          request_id: requestId(ctx.toolCallId, 'automation:create'),
          name: args.name,
          trigger: args.trigger,
          schedule: args.schedule,
          event_type: args.event_type,
          depends_on_run_id: args.depends_on_run_id,
          agent_session_id: args.agent_session_id,
          pipeline_id: args.pipeline_id,
          execution_target_id: args.execution_target_id,
          prompt: args.prompt,
          approval_required: args.approval_required,
        }));
      }
      if (args.operation === 'fire') {
        return success(await this.automations.fire(args.automation_id, {
          request_id: requestId(ctx.toolCallId, 'automation:fire'),
          actor: 'agent',
          policy_decision_id: args.policy_decision_id,
        }));
      }
      return success(await this.automations.update(args.automation_id, {
        request_id: requestId(ctx.toolCallId, `automation:${args.operation}`),
        state: args.operation === 'pause' ? 'paused' : 'enabled',
      }));
    } catch (error) {
      return failure(`Automation operation failed: ${errorText(error)}`);
    }
  }
}

export class MlTool implements IMlTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'ML' as const;
  readonly description =
    'Create and inspect governed ML experiments, local training Runs, evaluations, comparisons, and model registry records. Use native dataset and artifact references; executable code and raw provider secrets are not accepted.';
  readonly parameters = toInputJsonSchema(MlToolInputSchema);

  constructor(
    @IWorkspaceMlService private readonly ml: IWorkspaceMlService,
    @ISessionRunService private readonly runs: ISessionRunService,
    @ref(IWorkspaceArtifactService) private readonly artifacts: ArtifactServiceRef,
    @IPlatformConversationService private readonly conversation?: IPlatformConversationService,
    @IPlatformApprovalService private readonly approvals?: IPlatformApprovalService,
    @IWorkspaceDatasetService private readonly datasets?: IWorkspaceDatasetService,
  ) {}

  resolveExecution(args: MlToolInput): ToolExecution {
    return {
      description: `ML ${args.operation}`,
      approvalRule: PLATFORM_TOOL_APPROVAL,
      execute: (ctx) => this.execute(args, ctx),
    };
  }

  private async execute(args: MlToolInput, ctx: ExecutableToolContext): Promise<ExecutableToolResult> {
    try {
      if (args.operation === 'list_analyses') return success(await this.ml.listAnalyses());
      if (args.operation === 'inspect_analysis') {
        const analysis = await this.ml.getAnalysis(args.analysis_id);
        return analysis === undefined ? failure(`Analysis not found: ${args.analysis_id}`) : success(analysis);
      }
      if (args.operation === 'list_experiments') return success(await this.ml.listExperiments());
      if (args.operation === 'inspect_experiment') {
        const experiment = await this.ml.getExperiment(args.experiment_id);
        return experiment === undefined ? failure(`Experiment not found: ${args.experiment_id}`) : success(experiment);
      }
      if (args.operation === 'list_training_runs') return success(await this.ml.listTrainingRuns(args.experiment_id));
      if (args.operation === 'inspect_training_run') {
        const training = await this.ml.getTrainingRun(args.training_run_id);
        return training === undefined ? failure(`Training Run not found: ${args.training_run_id}`) : success(training);
      }
      if (args.operation === 'list_evaluations') return success(await this.ml.listEvaluations(args.experiment_id));
      if (args.operation === 'inspect_evaluation') {
        const evaluation = await this.ml.getEvaluation(args.evaluation_id);
        return evaluation === undefined ? failure(`Evaluation not found: ${args.evaluation_id}`) : success(evaluation);
      }
      if (args.operation === 'list_models') return success(await this.ml.listModels(args.model_name));
      if (args.operation === 'inspect_model') {
        const model = await this.ml.getModel(args.model_id);
        return model === undefined ? failure(`Model not found: ${args.model_id}`) : success(model);
      }

      const kind = args.operation === 'analyze'
        ? 'dataset_analysis'
        : args.operation === 'baseline_workflow'
          ? 'ml_baseline_workflow'
        : args.operation === 'create_experiment'
          ? 'experiment'
        : args.operation === 'train'
          ? 'training'
          : args.operation === 'evaluate'
            ? 'evaluation'
            : args.operation === 'compare'
              ? 'experiment_comparison'
              : args.operation === 'register_model'
                ? 'model_registration'
                : args.operation === 'stage_model'
                  ? 'model_stage'
                : 'training_cancel';
      const executionTargetId = 'execution_target_id' in args ? args.execution_target_id : undefined;
      const run = await createRun(this.runs, ctx, kind, {
        platform_operation: platformRunOperationMetadata('ml', replaySafeInput(args))['platform_operation'],
      }, executionTargetId, this.conversation);

      try {
        let output: {
          readonly analysis?: Analysis;
          readonly experiment?: Experiment;
          readonly training?: TrainingRun;
          readonly evaluation?: Evaluation;
          readonly comparison?: ExperimentComparison;
          readonly model?: ModelVersion;
          readonly workflow?: BaselineWorkflowResult;
          readonly artifact_ids?: readonly string[];
        };

        if (args.operation === 'baseline_workflow') {
          if (this.datasets === undefined) {
            await failRun(this.runs, ctx, run, new Error('Dataset services are unavailable in this session.'));
            return failure('Dataset services are unavailable in this session.');
          }
          if (args.dataset_id === undefined && (args.source_path === undefined && args.content_base64 === undefined)) {
            await failRun(this.runs, ctx, run, new Error('A dataset_id or local CSV/JSONL source is required.'));
            return failure('A dataset_id or local CSV/JSONL source is required.');
          }
          const artifactService = currentArtifactService(this.artifacts);
          if (artifactService === undefined) {
            await failRun(this.runs, ctx, run, new Error('Artifact services are unavailable in this session.'));
            return failure('Artifact services are unavailable in this session.');
          }
          progress(ctx, 'Starting the local dataset-to-model workflow…');
          const workflow = await executeBaselineWorkflow({
            datasets: this.datasets,
            ml: this.ml,
            artifacts: artifactService,
          }, {
            requestPrefix: requestId(ctx.toolCallId, 'ml:baseline'),
            runId: run.id,
            datasetId: args.dataset_id,
            datasetName: args.dataset_name,
            format: args.format,
            sourcePath: args.source_path,
            contentBase64: args.content_base64,
            datasetVersion: args.dataset_version,
            datasetPolicyDecisionId: args.dataset_policy_decision_id,
            modelPolicyDecisionId: args.model_policy_decision_id,
            executionTargetPolicyDecisionId: args.execution_target_policy_decision_id,
            target: args.target,
            features: args.features,
            task: args.task,
            algorithm: args.algorithm,
            experimentName: args.experiment_name,
            modelName: args.model_name,
            executionTargetId: args.execution_target_id,
            metrics: args.metrics ?? (args.task === 'classification'
              ? [{ name: 'accuracy', higher_is_better: true }]
              : [{ name: 'mae', higher_is_better: false }, { name: 'rmse', higher_is_better: false }]),
            hyperparameters: args.hyperparameters,
            seed: args.seed,
            metadata: args.metadata,
            onDatasetResolved: async (dataset) => {
              // Inline data is intentionally not copied into durable Run
              // metadata. Once ingestion succeeds, the dataset id is enough
              // to replay the rest of the workflow without persisting user
              // data in projections.
              await this.runs.transition(run.id, {
                request_id: requestId(ctx.toolCallId, `${run.id}:bind-dataset`),
                status: 'running',
                metadata: {
                  platform_operation: platformRunOperationMetadata('ml', {
                    ...replaySafeInput(args),
                    content_base64: undefined,
                    dataset_id: dataset.id,
                    dataset_name: dataset.name,
                    dataset_version: dataset.current_version,
                  })['platform_operation'],
                },
              });
            },
          }, (text) => progress(ctx, text));
          output = { workflow, artifact_ids: workflow.artifacts.map((artifact) => artifact.id) };
        } else if (args.operation === 'analyze') {
          const analysis = await this.ml.analyze({
            request_id: requestId(ctx.toolCallId, 'ml:analysis:create'),
            run_id: run.id,
            dataset_id: args.dataset_id,
            dataset_version: args.dataset_version,
            execution_target_id: args.execution_target_id,
            execution_target_policy_decision_id: args.execution_target_policy_decision_id,
            dataset_policy_decision_id: args.dataset_policy_decision_id,
            kind: args.kind,
            columns: args.columns,
            group_by: args.group_by,
            metadata: args.metadata,
          });
          if (analysis === undefined) {
            await failRun(this.runs, ctx, run, new Error('Analysis could not be created.'));
            return failure('Analysis could not be created.');
          }
          output = { analysis };
        } else if (args.operation === 'create_experiment') {
          output = {
            experiment: await this.ml.createExperiment({
              request_id: requestId(ctx.toolCallId, 'ml:experiment:create'),
              run_id: run.id,
              name: args.name,
              dataset_id: args.dataset_id,
              dataset_version: args.dataset_version,
              dataset_policy_decision_id: args.dataset_policy_decision_id,
              model_policy_decision_id: args.model_policy_decision_id,
              target: args.target,
              features: args.features,
              task: args.task,
              algorithm: args.algorithm,
              execution_target_id: args.execution_target_id,
              metrics: args.metrics,
              hyperparameters: args.hyperparameters,
              seed: args.seed,
              metadata: args.metadata,
            }),
          };
        } else if (args.operation === 'validate_experiment') {
          const experiment = await this.ml.validateExperiment(
            args.experiment_id,
            requestId(ctx.toolCallId, 'ml:experiment:validate'),
          );
          if (experiment === undefined) {
            await failRun(this.runs, ctx, run, new Error(`Experiment not found: ${args.experiment_id}`));
            return failure(`Experiment not found: ${args.experiment_id}`);
          }
          output = { experiment };
        } else if (args.operation === 'train') {
          const training = await this.ml.startTraining(args.experiment_id, {
            request_id: requestId(ctx.toolCallId, 'ml:training:start'),
            run_id: run.id,
            execution_target_id: args.execution_target_id,
            execution_target_policy_decision_id: args.execution_target_policy_decision_id,
            dataset_policy_decision_id: args.dataset_policy_decision_id,
            model_policy_decision_id: args.model_policy_decision_id,
          });
          if (training === undefined) {
            await failRun(this.runs, ctx, run, new Error(`Experiment not found: ${args.experiment_id}`));
            return failure(`Experiment not found: ${args.experiment_id}`);
          }
          output = { training };
        } else if (args.operation === 'cancel_training') {
          const current = await this.ml.getTrainingRun(args.training_run_id);
          if (current === undefined) {
            await failRun(this.runs, ctx, run, new Error(`Training Run not found: ${args.training_run_id}`));
            return failure(`Training Run not found: ${args.training_run_id}`);
          }
          const training = await this.ml.cancelTraining(args.training_run_id, {
            request_id: requestId(ctx.toolCallId, 'ml:training:cancel'),
            model_policy_decision_id: args.model_policy_decision_id,
          });
          output = { training: training ?? current };
        } else if (args.operation === 'evaluate') {
          const evaluation = await this.ml.evaluate({
            request_id: requestId(ctx.toolCallId, 'ml:evaluation:create'),
            run_id: run.id,
            experiment_id: args.experiment_id,
            dataset_id: args.dataset_id,
            dataset_version: args.dataset_version,
            execution_target_id: args.execution_target_id,
            execution_target_policy_decision_id: args.execution_target_policy_decision_id,
            dataset_policy_decision_id: args.dataset_policy_decision_id,
            model_policy_decision_id: args.model_policy_decision_id,
            candidate_model_artifact_id: args.candidate_model_artifact_id,
            baseline_model_artifact_id: args.baseline_model_artifact_id,
            benchmark_id: args.benchmark_id,
            benchmark_version: args.benchmark_version,
            minimum_sample_size: args.minimum_sample_size,
            metrics: args.metrics,
            limitations: args.limitations,
          });
          if (evaluation === undefined) {
            await failRun(this.runs, ctx, run, new Error('Evaluation could not be created.'));
            return failure('Evaluation could not be created.');
          }
          output = { evaluation };
        } else if (args.operation === 'compare') {
          const comparison = await this.ml.compare({
            request_id: requestId(ctx.toolCallId, 'ml:comparison:create'),
            run_id: run.id,
            experiment_ids: args.experiment_ids,
            model_policy_decision_id: args.model_policy_decision_id,
          });
          if (comparison === undefined) {
            await failRun(this.runs, ctx, run, new Error('Experiment comparison could not be created.'));
            return failure('Experiment comparison could not be created.');
          }
          output = { comparison };
        } else if (args.operation === 'register_model') {
          const model = await this.ml.registerModel({
            request_id: requestId(ctx.toolCallId, 'ml:model:register'),
            run_id: run.id,
            model_policy_decision_id: args.model_policy_decision_id,
            model_name: args.model_name,
            artifact_id: args.artifact_id,
            experiment_id: args.experiment_id,
            training_run_id: args.training_run_id,
            evaluation_id: args.evaluation_id,
            metrics: args.metrics,
            metadata: args.metadata,
          });
          if (model === undefined) {
            await failRun(this.runs, ctx, run, new Error('Model could not be registered.'));
            return failure('Model could not be registered.');
          }
          output = { model };
        } else {
          const staged = args as Extract<MlToolInput, { operation: 'stage_model' }>;
          const model = await this.ml.updateModelStage(staged.model_id, {
            request_id: requestId(ctx.toolCallId, 'ml:model:stage'),
            run_id: run.id,
            stage: staged.stage,
            model_policy_decision_id: staged.model_policy_decision_id,
            metadata: staged.metadata,
          });
          if (model === undefined) {
            await failRun(this.runs, ctx, run, new Error(`Model not found: ${staged.model_id}`));
            return failure(`Model not found: ${staged.model_id}`);
          }
          output = { model };
        }

        const outputArtifacts = await this.outputArtifacts(output);
        const finished = await completeRun(this.runs, ctx, run, outputArtifacts);
        const projectedOutput = output.workflow === undefined
          ? output
          : { ...output, workflow: baselineWorkflowProjection(output.workflow) };
        return success({ run: runRef(finished ?? run), ...projectedOutput });
      } catch (error) {
        if (detailString(error, 'policyDecisionId') !== undefined || (isError2(error) && error.code === 'ml.policy_required')) {
          const awaiting = await awaitApprovalRun(this.runs, ctx, run, error, undefined, this.approvals, `ML ${args.operation}`);
          const approval = approvalProjection(
            awaiting ?? run,
            'Approve the policy decision, then resume this Run to continue the ML operation.',
          );
          return success({
            run: runRef(awaiting ?? run),
            ...approval,
            policy_decision_id: detailString(error, 'policyDecisionId'),
          });
        }
        await failRun(this.runs, ctx, run, error);
        return failure(`ML operation failed: ${errorText(error)}`);
      }
    } catch (error) {
      return failure(`ML operation failed: ${errorText(error)}`);
    }
  }

  private async outputArtifacts(output: {
    readonly analysis?: Analysis;
    readonly experiment?: Experiment;
    readonly training?: TrainingRun;
    readonly evaluation?: Evaluation;
    readonly comparison?: ExperimentComparison;
    readonly model?: ModelVersion;
    readonly artifact_ids?: readonly string[];
  }): Promise<readonly Artifact[]> {
    const ids = new Set<string>();
    for (const id of output.artifact_ids ?? []) ids.add(id);
    if (output.training?.model_artifact_id !== undefined) ids.add(output.training.model_artifact_id);
    for (const id of output.training?.checkpoint_artifact_ids ?? []) ids.add(id);
    if (output.evaluation !== undefined) ids.add(output.evaluation.artifact_id);
    if (output.comparison !== undefined) ids.add(output.comparison.artifact_id);
    if (output.model !== undefined) ids.add(output.model.artifact_id);
    if (output.analysis !== undefined) {
      ids.add(output.analysis.report_artifact_id);
      for (const id of output.analysis.visualization_artifact_ids) ids.add(id);
      if (output.analysis.notebook_artifact_id !== undefined) ids.add(output.analysis.notebook_artifact_id);
    }
    const service = currentArtifactService(this.artifacts);
    if (service === undefined) return [];
    const artifacts: Artifact[] = [];
    for (const id of ids) {
      const artifact = await service.get(id);
      if (artifact !== undefined) artifacts.push(artifact);
    }
    return artifacts;
  }
}

export class ServingTool implements IServingTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'Serving' as const;
  readonly description =
    'Package trained model artifacts and deploy, inspect, pause, resume, archive, or roll back governed serving endpoints. Deployment targets and policy decisions remain explicit.';
  readonly parameters = toInputJsonSchema(ServingToolInputSchema);

  constructor(
    @IWorkspaceServingService private readonly serving: IWorkspaceServingService,
    @ISessionRunService private readonly runs: ISessionRunService,
    @IPlatformConversationService private readonly conversation?: IPlatformConversationService,
    @IPlatformApprovalService private readonly approvals?: IPlatformApprovalService,
  ) {}

  resolveExecution(args: ServingToolInput): ToolExecution {
    return {
      description: `Serving ${args.operation}`,
      approvalRule: PLATFORM_TOOL_APPROVAL,
      execute: (ctx) => this.execute(args, ctx),
    };
  }

  private async execute(args: ServingToolInput, ctx: ExecutableToolContext): Promise<ExecutableToolResult> {
    try {
      if (args.operation === 'list_packages') return success(await this.serving.listPackages());
      if (args.operation === 'inspect_package') return success(await this.serving.getPackage(args.package_id));
      if (args.operation === 'list_endpoints') return success(await this.serving.listEndpoints());
      if (args.operation === 'inspect_endpoint') return success(await this.serving.getEndpoint(args.endpoint_id));

      const run = await createRun(this.runs, ctx, `serving_${args.operation}`, {
        platform_operation: platformRunOperationMetadata('serving', replaySafeInput(args))['platform_operation'],
      }, 'execution_target_id' in args ? args.execution_target_id : undefined, this.conversation);
      try {
        if (args.operation === 'package') {
          const packaged = await this.serving.createPackage({
            request_id: requestId(ctx.toolCallId, 'serving:package'),
            run_id: run.id,
            model_version_id: args.model_version_id,
            execution_target_id: args.execution_target_id,
            model_policy_decision_id: args.model_policy_decision_id,
            execution_target_policy_decision_id: args.execution_target_policy_decision_id,
            metadata: args.metadata,
          });
          if (packaged === undefined) {
            await failRun(this.runs, ctx, run, new Error(`Model not found: ${args.model_version_id}`));
            return failure(`Model not found: ${args.model_version_id}`);
          }
          if (packaged.state === 'awaiting_approval') {
            const awaiting = await awaitApprovalRun(
              this.runs,
              ctx,
              run,
              new Error(packaged.error ?? 'model packaging approval is required'),
              packaged.policy_decision_id,
              this.approvals,
              'Package model for serving',
            );
            return success({
              run: runRef(awaiting ?? run),
              package: packaged,
              ...approvalProjection(awaiting ?? run, 'Approve the policy decision, then resume this Run to continue packaging.'),
            });
          }
          if (packaged.state === 'failed') {
            await failRun(this.runs, ctx, run, new Error(packaged.error ?? 'model packaging failed'));
            return failure(`Model packaging failed: ${packaged.error ?? 'unknown error'}`);
          }
          const finished = await completeRun(this.runs, ctx, run);
          return success({ run: runRef(finished ?? run), package: packaged });
        }
        if (args.operation === 'deploy') {
          const endpoint = await this.serving.deploy({
            request_id: requestId(ctx.toolCallId, 'serving:deploy'),
            run_id: run.id,
            name: args.name,
            model_package_id: args.package_id,
            execution_target_id: args.execution_target_id,
            deploy_policy_decision_id: args.deploy_policy_decision_id,
            execution_target_policy_decision_id: args.execution_target_policy_decision_id,
            metadata: args.metadata,
          });
          if (endpoint === undefined) {
            await failRun(this.runs, ctx, run, new Error(`Model package not found: ${args.package_id}`));
            return failure(`Model package not found: ${args.package_id}`);
          }
          if (endpoint.state === 'awaiting_approval') {
            const awaiting = await awaitApprovalRun(
              this.runs,
              ctx,
              run,
              new Error(endpoint.error ?? 'deployment approval is required'),
              endpoint.policy_decision_id,
              this.approvals,
              'Deploy model endpoint',
            );
            return success({
              run: runRef(awaiting ?? run),
              endpoint,
              ...approvalProjection(awaiting ?? run, 'Approve the policy decision, then resume this Run to continue deployment.'),
            });
          }
          if (endpoint.state === 'failed') {
            await failRun(this.runs, ctx, run, new Error(endpoint.error ?? 'deployment failed'));
            return failure(`Deployment failed: ${endpoint.error ?? 'unknown error'}`);
          }
          const finished = await completeRun(this.runs, ctx, run);
          return success({ run: runRef(finished ?? run), endpoint });
        }
        const action = args.operation === 'rollback' ? 'rollback' : args.operation;
        const endpointId = args.endpoint_id;
        const endpoint = await this.serving.action(endpointId, action, {
          request_id: requestId(ctx.toolCallId, `serving:${action}`),
          run_id: run.id,
          model_package_id: args.operation === 'rollback' ? args.package_id : undefined,
          deploy_policy_decision_id: 'deploy_policy_decision_id' in args ? args.deploy_policy_decision_id : undefined,
          execution_target_policy_decision_id: args.execution_target_policy_decision_id,
          metadata: args.metadata,
        });
        if (endpoint === undefined) {
          await failRun(this.runs, ctx, run, new Error(`Serving endpoint not found: ${endpointId}`));
          return failure(`Serving endpoint not found: ${endpointId}`);
        }
        if (endpoint.state === 'awaiting_approval') {
          const awaiting = await awaitApprovalRun(
            this.runs,
            ctx,
            run,
            new Error(endpoint.error ?? 'deployment approval is required'),
            endpoint.policy_decision_id,
            this.approvals,
            `Serving ${action}`,
          );
          return success({
            run: runRef(awaiting ?? run),
            endpoint,
            ...approvalProjection(awaiting ?? run, 'Approve the policy decision, then resume this Run to continue the serving operation.'),
          });
        }
        if (endpoint.state === 'failed') {
          await failRun(this.runs, ctx, run, new Error(endpoint.error ?? 'serving action failed'));
          return failure(`Serving action failed: ${endpoint.error ?? 'unknown error'}`);
        }
        const finished = await completeRun(this.runs, ctx, run);
        return success({ run: runRef(finished ?? run), endpoint });
      } catch (error) {
        if (detailString(error, 'policyDecisionId') !== undefined || (isError2(error) && error.code === 'serving.policy_required')) {
          const awaiting = await awaitApprovalRun(
            this.runs,
            ctx,
            run,
            error,
            undefined,
            this.approvals,
            `Serving ${args.operation}`,
          );
          return success({
            run: runRef(awaiting ?? run),
            ...approvalProjection(awaiting ?? run, 'Approve the policy decision, then resume this Run to continue the serving operation.'),
            policy_decision_id: detailString(error, 'policyDecisionId'),
          });
        }
        await failRun(this.runs, ctx, run, error);
        return failure(`Serving operation failed: ${errorText(error)}`);
      }
    } catch (error) {
      return failure(`Serving operation failed: ${errorText(error)}`);
    }
  }
}

export class PipelineTool implements IPipelineTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'Pipeline' as const;
  readonly description =
    'Create and run durable native ML/data pipelines. Pipeline steps reference datasets, experiments, models, and artifacts; arbitrary code and prompt-defined shell execution are not accepted.';
  readonly parameters = toInputJsonSchema(PipelineToolInputSchema);

  constructor(
    @IWorkspacePipelineService private readonly pipelines: IWorkspacePipelineService,
    @ISessionRunService private readonly runs: ISessionRunService,
    @IPlatformConversationService private readonly conversation?: IPlatformConversationService,
    @IPlatformApprovalService private readonly approvals?: IPlatformApprovalService,
  ) {}

  resolveExecution(args: PipelineToolInput): ToolExecution {
    return {
      description: `Pipeline ${args.operation}`,
      approvalRule: PLATFORM_TOOL_APPROVAL,
      execute: (ctx) => this.execute(args, ctx),
    };
  }

  private async execute(args: PipelineToolInput, ctx: ExecutableToolContext): Promise<ExecutableToolResult> {
    try {
      if (args.operation === 'list') return success(await this.pipelines.list());
      if (args.operation === 'inspect') {
        const pipeline = await this.pipelines.get(args.pipeline_id);
        return pipeline === undefined ? failure(`Pipeline not found: ${args.pipeline_id}`) : success(pipeline);
      }
      if (args.operation === 'list_runs') return success(await this.pipelines.listRuns(args.pipeline_id));
      if (args.operation === 'inspect_run') {
        const pipelineRun = await this.pipelines.getRun(args.pipeline_run_id);
        return pipelineRun === undefined ? failure(`Pipeline Run not found: ${args.pipeline_run_id}`) : success(pipelineRun);
      }
      if (args.operation === 'create') {
        const pipeline = await this.pipelines.create({
          request_id: requestId(ctx.toolCallId, 'pipeline:create'),
          name: args.name,
          steps: args.steps.map((step) => ({ ...step, depends_on: step.depends_on ?? [] })),
          metadata: args.metadata,
        });
        return success(pipeline);
      }

      const run = await createRun(
        this.runs,
        ctx,
        args.operation === 'run' ? 'pipeline' : 'pipeline_cancel',
        args.operation === 'run'
          ? { platform_operation: platformRunOperationMetadata('pipeline', args)['platform_operation'] }
          : undefined,
        args.operation === 'run' ? args.execution_target_id : undefined,
        this.conversation,
      );
      try {
        if (args.operation === 'run') {
          const pipelineRun = await this.pipelines.run(args.pipeline_id, {
            request_id: requestId(ctx.toolCallId, 'pipeline:run'),
            run_id: run.id,
            execution_target_id: args.execution_target_id,
            execution_target_policy_decision_id: args.execution_target_policy_decision_id,
            policy_decision_id: args.policy_decision_id,
          });
          if (pipelineRun === undefined) {
            await failRun(this.runs, ctx, run, new Error(`Pipeline not found: ${args.pipeline_id}`));
            return failure(`Pipeline not found: ${args.pipeline_id}`);
          }
          const finished = pipelineRun.status === 'succeeded'
            ? await completeRun(this.runs, ctx, run)
              : pipelineRun.status === 'awaiting_approval'
              ? await awaitApprovalRun(
                this.runs,
                ctx,
                run,
                new Error(pipelineRun.error ?? 'pipeline approval required'),
                typeof pipelineRun.metadata?.['policy_decision_id'] === 'string'
                  ? pipelineRun.metadata['policy_decision_id']
                  : undefined,
                this.approvals,
                'Run pipeline',
              )
              : pipelineRun.status === 'cancelled'
                ? await this.runs.transition(run.id, { request_id: requestId(ctx.toolCallId, 'pipeline:cancelled'), status: 'cancelled', status_reason: pipelineRun.error })
                : undefined;
          if (pipelineRun.status !== 'succeeded' && pipelineRun.status !== 'awaiting_approval' && pipelineRun.status !== 'cancelled') {
            await failRun(this.runs, ctx, run, new Error(pipelineRun.error ?? 'pipeline failed'));
          }
          const projectedRun = finished ?? run;
          return success({
            run: runRef(projectedRun),
            pipeline_run: pipelineRun,
            ...(pipelineRun.status === 'awaiting_approval'
              ? approvalProjection(projectedRun, 'Approve the policy decision, then resume this Run to continue the pipeline.')
              : {}),
          });
        }
        const pipelineRun = await this.pipelines.cancelRun(args.pipeline_run_id, {
          request_id: requestId(ctx.toolCallId, 'pipeline:cancel'),
        });
        if (pipelineRun === undefined) {
          await failRun(this.runs, ctx, run, new Error(`Pipeline Run not found: ${args.pipeline_run_id}`));
          return failure(`Pipeline Run not found: ${args.pipeline_run_id}`);
        }
        const finished = await completeRun(this.runs, ctx, run);
        return success({ run: runRef(finished ?? run), pipeline_run: pipelineRun });
      } catch (error) {
        if (detailString(error, 'policyDecisionId') !== undefined || (isError2(error) && error.code === 'pipeline.policy_required')) {
          const awaiting = await awaitApprovalRun(this.runs, ctx, run, error, undefined, this.approvals, `Pipeline ${args.operation}`);
          return success({
            run: runRef(awaiting ?? run),
            ...approvalProjection(awaiting ?? run, 'Approve the policy decision, then resume this Run to continue the pipeline.'),
            policy_decision_id: detailString(error, 'policyDecisionId'),
          });
        }
        await failRun(this.runs, ctx, run, error);
        return failure(`Pipeline operation failed: ${errorText(error)}`);
      }
    } catch (error) {
      return failure(`Pipeline operation failed: ${errorText(error)}`);
    }
  }
}

function compactQueryResult(result: DatasetQueryResult): Record<string, unknown> {
  return {
    ...result,
    rows: result.rows.slice(0, MAX_TRANSCRIPT_ROWS),
    rows_shown: Math.min(result.rows.length, MAX_TRANSCRIPT_ROWS),
    rows_omitted: Math.max(0, result.rows.length - MAX_TRANSCRIPT_ROWS),
  };
}

registerAgentToolService(IDatasetTool, DatasetTool, {
  name: 'Dataset',
  domain: 'platform/data',
  when: platformWhen,
});
registerAgentToolService(IRunTool, RunTool, {
  name: 'Run',
  domain: 'platform/runs',
  when: platformWhen,
});
registerAgentToolService(IProviderTool, ProviderTool, {
  name: 'Provider',
  domain: 'platform/providers',
  when: platformWhen,
});
registerAgentToolService(IArtifactTool, ArtifactTool, {
  name: 'Artifact',
  domain: 'platform/artifacts',
  when: platformWhen,
});
registerAgentToolService(IGovernanceTool, GovernanceTool, {
  name: 'Governance',
  domain: 'platform/governance',
  when: platformWhen,
});
registerAgentToolService(IResourceTool, ResourceTool, {
  name: 'Resource',
  domain: 'platform/resources',
  when: platformWhen,
});
registerAgentToolService(IExecutionTargetTool, ExecutionTargetTool, {
  name: 'ExecutionTarget',
  domain: 'platform/execution-targets',
  when: platformWhen,
});
registerAgentToolService(IAutomationTool, AutomationTool, {
  name: 'Automation',
  domain: 'platform/automations',
  when: platformWhen,
});
registerAgentToolService(IMlTool, MlTool, {
  name: 'ML',
  domain: 'platform/ml',
  when: platformWhen,
});
registerAgentToolService(IPipelineTool, PipelineTool, {
  name: 'Pipeline',
  domain: 'platform/pipelines',
  when: platformWhen,
});
registerAgentToolService(IServingTool, ServingTool, {
  name: 'Serving',
  domain: 'platform/serving',
  when: platformWhen,
});
