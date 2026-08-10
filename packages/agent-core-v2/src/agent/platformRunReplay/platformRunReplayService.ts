/**
 * `platformRunReplay` domain — replays secret-free platform operation
 * descriptors attached to durable child Runs.
 *
 * The service is Agent-scoped because it drives the current session Run while
 * delegating the actual work to the authoritative Workspace platform
 * services. Service request ids are derived from the child Run, so a process
 * restart reuses the existing idempotency records instead of creating a
 * second dataset, model, pipeline, or serving object. Bound at Agent scope.
 */

import { z } from 'zod';

import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { Error2, ErrorCodes, isError2 } from '#/errors';
import { ISessionRunService } from '#/session/run/run';
import { IWorkspaceArtifactService } from '#/workspace/artifacts/artifact';
import { IWorkspaceDatasetService } from '#/workspace/datasets/dataset';
import { IWorkspaceMlService } from '#/workspace/ml/ml';
import { IWorkspacePipelineService } from '#/workspace/pipelines/pipeline';
import { IWorkspacePolicyService } from '#/workspace/policy/policy';
import { IWorkspaceProviderConnectionService } from '#/workspace/providerConnections/providerConnection';
import { IWorkspaceProviderRuntimeService } from '#/workspace/providerConnections/providerRuntime';
import { IWorkspaceResourceService } from '#/workspace/resources/resource';
import { IWorkspaceServingService } from '#/workspace/serving/serving';
import type { Run } from '@moonshot-ai/protocol';

import {
  IPlatformRunReplayService,
  platformRunOperation,
  type PlatformRunOperation,
  type PlatformRunReplayResult,
} from './platformRunReplay';
import {
  baselineWorkflowProjection,
  executeBaselineWorkflow,
} from '#/agent/tools/platform/baselineWorkflow';

const metricSpecSchema = z.strictObject({
  name: z.string().min(1).max(160),
  higher_is_better: z.boolean().optional(),
  required_minimum: z.number().finite().optional(),
  maximum_regression: z.number().finite().nonnegative().optional(),
});

const metricsSchema = z.array(metricSpecSchema).max(32);
const numericMetricsSchema = z.record(z.string(), z.number().finite());

type DispatchResult = {
  readonly result: unknown;
  readonly artifact_ids?: readonly string[];
  readonly approval_required?: boolean;
  readonly policy_decision_id?: string;
};

export class PlatformRunReplayService implements IPlatformRunReplayService {
  declare readonly _serviceBrand: undefined;

  constructor(
    @ISessionRunService private readonly runs: ISessionRunService,
    @IWorkspaceArtifactService private readonly artifacts: IWorkspaceArtifactService,
    @IWorkspaceDatasetService private readonly datasets: IWorkspaceDatasetService,
    @IWorkspaceProviderConnectionService private readonly connections: IWorkspaceProviderConnectionService,
    @IWorkspaceProviderRuntimeService private readonly runtime: IWorkspaceProviderRuntimeService,
    @IWorkspaceResourceService private readonly resources: IWorkspaceResourceService,
    @IWorkspaceMlService private readonly ml: IWorkspaceMlService,
    @IWorkspacePipelineService private readonly pipelines: IWorkspacePipelineService,
    @IWorkspaceServingService private readonly serving: IWorkspaceServingService,
    @IWorkspacePolicyService private readonly policy: IWorkspacePolicyService,
  ) {}

  async replay(runId: string, requestId: string): Promise<PlatformRunReplayResult> {
    const current = await this.runs.get(runId);
    if (current === undefined) {
      throw new Error2(ErrorCodes.REQUEST_INVALID, `run not found: ${runId}`, {
        details: { runId },
      });
    }
    const operation = platformRunOperation(current);
    if (operation === undefined) {
      return {
        run: current,
        replayable: false,
        error: 'Run has no replayable platform operation descriptor',
      };
    }
    if (isTerminal(current.status)) {
      return { run: current, replayable: true };
    }
    if (current.status === 'awaiting_approval') {
      return {
        run: current,
        replayable: true,
        approval_required: true,
        policy_decision_id: current.policy_decision_ids?.at(-1),
      };
    }

    try {
      let running = current;
      if (running.status === 'queued') {
        running = (await this.runs.transition(runId, {
          request_id: transitionRequestId(requestId, 'planning'),
          status: 'planning',
        })) ?? running;
      }
      if (running.status === 'planning') {
        running = (await this.runs.transition(runId, {
          request_id: transitionRequestId(requestId, 'running'),
          status: 'running',
        })) ?? running;
      }
      if (running.status !== 'running') {
        return {
          run: running,
          replayable: true,
          error: `Run cannot be replayed from status ${running.status}`,
        };
      }

      const dispatched = await this.dispatch(operation, running);
      if (dispatched.approval_required) {
        const awaiting = await this.runs.transition(runId, {
          request_id: transitionRequestId(requestId, 'approval'),
          status: 'awaiting_approval',
          policy_decision_ids: dispatched.policy_decision_id === undefined
            ? undefined
            : [...new Set([...(running.policy_decision_ids ?? []), dispatched.policy_decision_id])],
          status_reason: 'platform operation approval is required',
        });
        return {
          run: awaiting ?? running,
          replayable: true,
          approval_required: true,
          policy_decision_id: dispatched.policy_decision_id,
          result: dispatched.result,
        };
      }

      const outputArtifacts = await this.artifactRefs(dispatched.artifact_ids);
      const completed = await this.runs.transition(runId, {
        request_id: transitionRequestId(requestId, 'succeeded'),
        status: 'succeeded',
        output_artifacts: outputArtifacts,
      });
      return {
        run: completed ?? running,
        replayable: true,
        result: dispatched.result,
      };
    } catch (error) {
      const policyDecisionId = policyDecisionIdFrom(error);
      if (policyDecisionId !== undefined || isPolicyRequired(error)) {
        const latest = (await this.runs.get(runId)) ?? current;
        const awaiting = await this.runs.transition(runId, {
          request_id: transitionRequestId(requestId, 'approval'),
          status: 'awaiting_approval',
          policy_decision_ids: policyDecisionId === undefined
            ? undefined
            : [...new Set([...(latest.policy_decision_ids ?? []), policyDecisionId])],
          status_reason: safeError(error),
        }).catch(() => undefined);
        return {
          run: awaiting ?? (await this.runs.get(runId)) ?? current,
          replayable: true,
          approval_required: true,
          policy_decision_id: policyDecisionId,
          error: safeError(error),
        };
      }
      const failed = await this.runs.transition(runId, {
        request_id: transitionRequestId(requestId, 'failed'),
        status: 'failed',
        status_reason: safeError(error),
      }).catch(() => undefined);
      return {
        run: failed ?? (await this.runs.get(runId)) ?? current,
        replayable: true,
        error: safeError(error),
      };
    }
  }

  private async dispatch(
    operation: PlatformRunOperation,
    run: Run,
  ): Promise<DispatchResult> {
    const input = operation.input;
    const serviceRequest = (suffix: string): string => operationRequestId(run.id, operation, suffix);

    if (operation.domain === 'dataset') {
      if (operation.operation === 'profile') {
        const datasetId = requiredString(input, 'dataset_id');
        const profile = await this.datasets.profile(datasetId, {
          request_id: serviceRequest('profile'),
          run_id: run.id,
          version: optionalPositiveInt(input, 'version'),
          policy_decision_id: await this.approvedPolicyId(input, 'policy_decision_id', run, 'dataset'),
        });
        if (profile === undefined) throw invalidInput(`dataset not found: ${datasetId}`);
        return { result: profile, artifact_ids: [profile.artifact_id] };
      }
      if (operation.operation === 'query') {
        const datasetId = requiredString(input, 'dataset_id');
        const result = await this.datasets.query(datasetId, {
          request_id: serviceRequest('query'),
          run_id: run.id,
          sql: requiredString(input, 'sql'),
          version: optionalPositiveInt(input, 'version'),
          max_rows: optionalPositiveInt(input, 'max_rows'),
          policy_decision_id: await this.approvedPolicyId(input, 'policy_decision_id', run, 'dataset'),
        });
        if (result === undefined) throw invalidInput(`dataset not found: ${datasetId}`);
        return { result, artifact_ids: [result.artifact_id] };
      }
      if (operation.operation === 'transform') {
        const datasetId = requiredString(input, 'dataset_id');
        const dataset = await this.datasets.transform(datasetId, {
          request_id: serviceRequest('transform'),
          run_id: run.id,
          sql: requiredString(input, 'sql'),
          version: optionalPositiveInt(input, 'version'),
          max_rows: optionalPositiveInt(input, 'max_rows'),
          policy_decision_id: await this.approvedPolicyId(input, 'policy_decision_id', run, 'dataset'),
          metadata: optionalRecord(input, 'metadata'),
        });
        if (dataset === undefined) throw invalidInput(`dataset not found: ${datasetId}`);
        const version = dataset.versions.find((candidate) => candidate.version === dataset.current_version);
        return {
          result: dataset,
          artifact_ids: version === undefined ? [] : [version.artifact_id],
        };
      }
      throw invalidInput(`dataset operation is not replayable: ${operation.operation}`);
    }

    if (operation.domain === 'provider') {
      if (operation.operation !== 'validate') {
        throw invalidInput(`provider operation is not replayable: ${operation.operation}`);
      }
      const connectionId = requiredString(input, 'connection_id');
      const model = optionalString(input, 'model');
      const validation = await this.runtime.validate(connectionId, model, {
        request_id: serviceRequest('validate'),
        run_id: run.id,
        policy_decision_id: await this.approvedPolicyId(input, 'policy_decision_id', run, 'model'),
        actor: 'agent',
      });
      if (!validation.ok) {
        if (validation.policy_decision_id !== undefined) {
          return {
            result: validation,
            approval_required: true,
            policy_decision_id: validation.policy_decision_id,
          };
        }
        throw invalidInput(validation.error ?? 'provider validation failed');
      }
      const connection = await this.connections.validate(connectionId, {
        request_id: serviceRequest('validated'),
      });
      return {
        result: {
          connection_id: validation.connection_id,
          model: validation.model,
          ok: validation.ok,
          duration_ms: validation.duration_ms,
          usage_recorded: validation.usage !== undefined,
          connection_state: connection?.state,
        },
      };
    }

    if (operation.domain === 'resource') {
      if (operation.operation !== 'execute') {
        throw invalidInput(`resource operation is not replayable: ${operation.operation}`);
      }
      const resourceId = requiredString(input, 'resource_id');
      const execution = await this.resources.execute(resourceId, {
        request_id: serviceRequest('execute'),
        run_id: run.id,
        action: requiredString(input, 'action'),
        parameters: optionalRecord(input, 'parameters'),
        policy_decision_id: policyId(input, 'policy_decision_id', run),
      });
      if (execution.status === 'awaiting_approval') {
        return {
          result: execution,
          approval_required: true,
          policy_decision_id: execution.policy_decision_id,
        };
      }
      if (execution.status === 'failed') throw invalidInput(execution.error ?? 'resource execution failed');
      return { result: execution, artifact_ids: execution.output_artifact_ids };
    }

    if (operation.domain === 'ml') {
      return this.dispatchMl(operation, input, run, serviceRequest);
    }

    if (operation.domain === 'pipeline') {
      if (operation.operation !== 'run') {
        throw invalidInput(`pipeline operation is not replayable: ${operation.operation}`);
      }
      const pipelineId = requiredString(input, 'pipeline_id');
      const pipelineRun = await this.pipelines.run(pipelineId, {
        request_id: serviceRequest('run'),
        run_id: run.id,
        execution_target_id: run.execution_target_id ?? optionalString(input, 'execution_target_id'),
        execution_target_policy_decision_id: await this.approvedPolicyId(input, 'execution_target_policy_decision_id', run, 'cloud'),
        policy_decision_id: await this.approvedPolicyId(input, 'policy_decision_id', run, 'model'),
      });
      if (pipelineRun === undefined) throw invalidInput(`pipeline not found: ${pipelineId}`);
      if (pipelineRun.status === 'awaiting_approval') {
        return {
          result: pipelineRun,
          approval_required: true,
          policy_decision_id: optionalString(pipelineRun.metadata ?? {}, 'policy_decision_id'),
        };
      }
      if (pipelineRun.status === 'failed') throw invalidInput(pipelineRun.error ?? 'pipeline failed');
      return { result: pipelineRun, artifact_ids: pipelineRun.output_artifact_ids };
    }

    if (operation.domain === 'serving') {
      return this.dispatchServing(operation, input, run, serviceRequest);
    }

    throw invalidInput('unknown platform operation domain');
  }

  private async dispatchMl(
    operation: PlatformRunOperation,
    input: Readonly<Record<string, unknown>>,
    run: Run,
    serviceRequest: (suffix: string) => string,
  ): Promise<DispatchResult> {
    if (operation.operation === 'baseline_workflow') {
      const task = requiredString(input, 'task');
      if (task !== 'classification' && task !== 'regression') {
        throw invalidInput(`unsupported baseline workflow task: ${task}`);
      }
      const datasetId = optionalString(input, 'dataset_id');
      if (datasetId === undefined) {
        throw invalidInput('baseline workflow replay requires the ingested dataset id');
      }
      const workflow = await executeBaselineWorkflow({
        datasets: this.datasets,
        ml: this.ml,
        artifacts: this.artifacts,
      }, {
        requestPrefix: serviceRequest('baseline'),
        runId: run.id,
        datasetId,
        datasetVersion: optionalPositiveInt(input, 'dataset_version'),
        datasetPolicyDecisionId: await this.approvedPolicyId(input, 'dataset_policy_decision_id', run, 'dataset'),
        modelPolicyDecisionId: await this.approvedPolicyId(input, 'model_policy_decision_id', run, 'model'),
        executionTargetPolicyDecisionId: await this.approvedPolicyId(input, 'execution_target_policy_decision_id', run, 'cloud'),
        target: requiredString(input, 'target'),
        features: requiredStringArray(input, 'features'),
        task,
        algorithm: optionalString(input, 'algorithm'),
        experimentName: optionalString(input, 'experiment_name'),
        modelName: optionalString(input, 'model_name'),
        executionTargetId: run.execution_target_id ?? optionalString(input, 'execution_target_id'),
        metrics: input['metrics'] === undefined
          ? task === 'classification'
            ? [{ name: 'accuracy', higher_is_better: true }]
            : [{ name: 'mae', higher_is_better: false }, { name: 'rmse', higher_is_better: false }]
          : metricsSchema.parse(input['metrics']),
        hyperparameters: optionalRecord(input, 'hyperparameters'),
        seed: optionalNonnegativeInt(input, 'seed'),
      });
      return {
        result: baselineWorkflowProjection(workflow),
        artifact_ids: workflow.artifacts.map((artifact) => artifact.id),
      };
    }
    if (operation.operation === 'analyze') {
      const analysis = await this.ml.analyze({
        request_id: serviceRequest('analysis'),
        run_id: run.id,
        dataset_id: requiredString(input, 'dataset_id'),
        dataset_version: optionalPositiveInt(input, 'dataset_version'),
        execution_target_id: run.execution_target_id ?? optionalString(input, 'execution_target_id'),
        execution_target_policy_decision_id: await this.approvedPolicyId(input, 'execution_target_policy_decision_id', run, 'cloud'),
        dataset_policy_decision_id: await this.approvedPolicyId(input, 'dataset_policy_decision_id', run, 'dataset'),
        kind: optionalString(input, 'kind') as 'summary' | 'visualization' | 'notebook' | undefined,
        columns: optionalStringArray(input, 'columns'),
        group_by: optionalString(input, 'group_by'),
      });
      if (analysis === undefined) throw invalidInput('analysis could not be created');
      return {
        result: analysis,
        artifact_ids: [
          analysis.report_artifact_id,
          ...analysis.visualization_artifact_ids,
          ...(analysis.notebook_artifact_id === undefined ? [] : [analysis.notebook_artifact_id]),
        ],
      };
    }
    if (operation.operation === 'create_experiment') {
      const experiment = await this.ml.createExperiment({
        request_id: serviceRequest('experiment'),
        run_id: run.id,
        name: requiredString(input, 'name'),
        dataset_id: requiredString(input, 'dataset_id'),
        dataset_version: optionalPositiveInt(input, 'dataset_version'),
        dataset_policy_decision_id: await this.approvedPolicyId(input, 'dataset_policy_decision_id', run, 'dataset'),
        model_policy_decision_id: await this.approvedPolicyId(input, 'model_policy_decision_id', run, 'model'),
        target: requiredString(input, 'target'),
        features: requiredStringArray(input, 'features'),
        task: requiredString(input, 'task') as 'classification' | 'regression' | 'custom',
        algorithm: requiredString(input, 'algorithm'),
        execution_target_id: optionalString(input, 'execution_target_id'),
        metrics: metricsSchema.parse(input['metrics']),
        hyperparameters: optionalRecord(input, 'hyperparameters'),
        seed: optionalNonnegativeInt(input, 'seed'),
      });
      return { result: experiment };
    }
    if (operation.operation === 'validate_experiment') {
      const experimentId = requiredString(input, 'experiment_id');
      const experiment = await this.ml.validateExperiment(experimentId, serviceRequest('validate'));
      if (experiment === undefined) throw invalidInput(`experiment not found: ${experimentId}`);
      return { result: experiment };
    }
    if (operation.operation === 'train') {
      const training = await this.ml.startTraining(requiredString(input, 'experiment_id'), {
        request_id: serviceRequest('training'),
        run_id: run.id,
        execution_target_id: run.execution_target_id ?? optionalString(input, 'execution_target_id'),
        execution_target_policy_decision_id: await this.approvedPolicyId(input, 'execution_target_policy_decision_id', run, 'cloud'),
        dataset_policy_decision_id: await this.approvedPolicyId(input, 'dataset_policy_decision_id', run, 'dataset'),
        model_policy_decision_id: await this.approvedPolicyId(input, 'model_policy_decision_id', run, 'model'),
      });
      if (training === undefined) throw invalidInput('experiment not found');
      if (training.status === 'failed') throw invalidInput(training.error ?? 'training failed');
      return {
        result: training,
        artifact_ids: [
          ...training.checkpoint_artifact_ids,
          ...(training.model_artifact_id === undefined ? [] : [training.model_artifact_id]),
        ],
      };
    }
    if (operation.operation === 'cancel_training') {
      const trainingId = requiredString(input, 'training_run_id');
      const training = await this.ml.cancelTraining(trainingId, {
        request_id: serviceRequest('cancel'),
        model_policy_decision_id: await this.approvedPolicyId(input, 'model_policy_decision_id', run, 'model'),
      });
      if (training === undefined) throw invalidInput(`training Run not found: ${trainingId}`);
      if (training.status === 'failed') throw invalidInput(training.error ?? 'training cancellation failed');
      return {
        result: training,
        artifact_ids: [
          ...training.checkpoint_artifact_ids,
          ...(training.model_artifact_id === undefined ? [] : [training.model_artifact_id]),
        ],
      };
    }
    if (operation.operation === 'evaluate') {
      const evaluation = await this.ml.evaluate({
        request_id: serviceRequest('evaluation'),
        run_id: run.id,
        experiment_id: optionalString(input, 'experiment_id'),
        dataset_id: requiredString(input, 'dataset_id'),
        dataset_version: optionalPositiveInt(input, 'dataset_version'),
        execution_target_id: run.execution_target_id ?? optionalString(input, 'execution_target_id'),
        execution_target_policy_decision_id: await this.approvedPolicyId(input, 'execution_target_policy_decision_id', run, 'cloud'),
        dataset_policy_decision_id: await this.approvedPolicyId(input, 'dataset_policy_decision_id', run, 'dataset'),
        model_policy_decision_id: await this.approvedPolicyId(input, 'model_policy_decision_id', run, 'model'),
        candidate_model_artifact_id: requiredString(input, 'candidate_model_artifact_id'),
        baseline_model_artifact_id: optionalString(input, 'baseline_model_artifact_id'),
        benchmark_id: optionalString(input, 'benchmark_id'),
        benchmark_version: optionalPositiveInt(input, 'benchmark_version'),
        minimum_sample_size: optionalPositiveInt(input, 'minimum_sample_size'),
        metrics: input['metrics'] === undefined ? undefined : metricsSchema.parse(input['metrics']),
        limitations: optionalStringArray(input, 'limitations'),
      });
      if (evaluation === undefined) throw invalidInput('evaluation could not be created');
      return { result: evaluation, artifact_ids: [evaluation.artifact_id] };
    }
    if (operation.operation === 'compare') {
      const comparison = await this.ml.compare({
        request_id: serviceRequest('comparison'),
        run_id: run.id,
        experiment_ids: requiredStringArray(input, 'experiment_ids'),
        model_policy_decision_id: await this.approvedPolicyId(input, 'model_policy_decision_id', run, 'model'),
      });
      if (comparison === undefined) throw invalidInput('experiment comparison could not be created');
      return { result: comparison, artifact_ids: [comparison.artifact_id] };
    }
    if (operation.operation === 'register_model') {
      const model = await this.ml.registerModel({
        request_id: serviceRequest('model'),
        run_id: run.id,
        model_policy_decision_id: await this.approvedPolicyId(input, 'model_policy_decision_id', run, 'model'),
        model_name: requiredString(input, 'model_name'),
        artifact_id: requiredString(input, 'artifact_id'),
        experiment_id: requiredString(input, 'experiment_id'),
        training_run_id: requiredString(input, 'training_run_id'),
        evaluation_id: optionalString(input, 'evaluation_id'),
        metrics: input['metrics'] === undefined ? undefined : numericMetricsSchema.parse(input['metrics']),
      });
      if (model === undefined) throw invalidInput('model could not be registered');
      return { result: model, artifact_ids: [model.artifact_id, ...model.lineage_artifact_ids] };
    }
    if (operation.operation === 'stage_model') {
      const modelId = requiredString(input, 'model_id');
      const model = await this.ml.updateModelStage(modelId, {
        request_id: serviceRequest('stage'),
        run_id: run.id,
        stage: requiredString(input, 'stage') as 'candidate' | 'validated' | 'production' | 'archived',
        model_policy_decision_id: await this.approvedPolicyId(input, 'model_policy_decision_id', run, 'model'),
      });
      if (model === undefined) throw invalidInput(`model not found: ${modelId}`);
      return { result: model, artifact_ids: [model.artifact_id, ...model.lineage_artifact_ids] };
    }
    throw invalidInput(`ML operation is not replayable: ${operation.operation}`);
  }

  private async dispatchServing(
    operation: PlatformRunOperation,
    input: Readonly<Record<string, unknown>>,
    run: Run,
    serviceRequest: (suffix: string) => string,
  ): Promise<DispatchResult> {
    if (operation.operation === 'package') {
      const packaged = await this.serving.createPackage({
        request_id: serviceRequest('package'),
        run_id: run.id,
        model_version_id: requiredString(input, 'model_version_id'),
        execution_target_id: run.execution_target_id ?? optionalString(input, 'execution_target_id'),
        model_policy_decision_id: await this.approvedPolicyId(input, 'model_policy_decision_id', run, 'model'),
        execution_target_policy_decision_id: await this.approvedPolicyId(input, 'execution_target_policy_decision_id', run, 'cloud'),
      });
      if (packaged === undefined) throw invalidInput('model package could not be created');
      if (packaged.state === 'awaiting_approval') {
        return { result: packaged, approval_required: true, policy_decision_id: packaged.policy_decision_id };
      }
      if (packaged.state === 'failed') throw invalidInput(packaged.error ?? 'model packaging failed');
      return {
        result: packaged,
        artifact_ids: [packaged.model_artifact_id, ...(packaged.bundle_artifact_id === undefined ? [] : [packaged.bundle_artifact_id])],
      };
    }
    if (operation.operation === 'deploy') {
      const endpoint = await this.serving.deploy({
        request_id: serviceRequest('deploy'),
        run_id: run.id,
        name: requiredString(input, 'name'),
        model_package_id: requiredString(input, 'package_id'),
        execution_target_id: run.execution_target_id ?? optionalString(input, 'execution_target_id'),
        deploy_policy_decision_id: await this.approvedPolicyId(input, 'deploy_policy_decision_id', run, 'deploy'),
        execution_target_policy_decision_id: await this.approvedPolicyId(input, 'execution_target_policy_decision_id', run, 'cloud'),
      });
      if (endpoint === undefined) throw invalidInput('serving endpoint could not be created');
      if (endpoint.state === 'awaiting_approval') {
        return { result: endpoint, approval_required: true, policy_decision_id: endpoint.policy_decision_id };
      }
      if (endpoint.state === 'failed') throw invalidInput(endpoint.error ?? 'serving deployment failed');
      return {
        result: endpoint,
        artifact_ids: [endpoint.bundle_artifact_id, ...endpoint.lineage_artifact_ids].filter(
          (id): id is string => id !== undefined,
        ),
      };
    }
    if (!['pause', 'resume', 'archive', 'rollback'].includes(operation.operation)) {
      throw invalidInput(`serving operation is not replayable: ${operation.operation}`);
    }
    const action = operation.operation as 'pause' | 'resume' | 'archive' | 'rollback';
    const endpoint = await this.serving.action(
      requiredString(input, 'endpoint_id'),
      action,
      {
        request_id: serviceRequest(action),
        run_id: run.id,
        model_package_id: optionalString(input, 'package_id'),
        deploy_policy_decision_id: await this.approvedPolicyId(input, 'deploy_policy_decision_id', run, 'deploy'),
        execution_target_policy_decision_id: await this.approvedPolicyId(input, 'execution_target_policy_decision_id', run, 'cloud'),
      },
    );
    if (endpoint === undefined) throw invalidInput('serving endpoint not found');
    if (endpoint.state === 'awaiting_approval') {
      return { result: endpoint, approval_required: true, policy_decision_id: endpoint.policy_decision_id };
    }
    if (endpoint.state === 'failed') throw invalidInput(endpoint.error ?? 'serving action failed');
    return {
      result: endpoint,
      artifact_ids: [endpoint.bundle_artifact_id, ...endpoint.lineage_artifact_ids].filter(
        (id): id is string => id !== undefined,
      ),
    };
  }

  private async approvedPolicyId(
    input: Readonly<Record<string, unknown>>,
    key: string,
    run: Run,
    capability: 'dataset' | 'model' | 'deploy' | 'cloud',
  ): Promise<string | undefined> {
    const explicit = optionalString(input, key);
    if (explicit !== undefined) return explicit;
    for (const id of (run.policy_decision_ids ?? []).toReversed()) {
      const decision = await this.policy.get(id);
      if (
        decision?.capability === capability
        && decision.outcome !== 'deny'
        && decision.state !== 'denied'
        && (decision.outcome === 'allow' || decision.state === 'approved' || decision.state === 'audited')
      ) {
        return id;
      }
    }
    return undefined;
  }

  private async artifactRefs(ids: readonly string[] | undefined): Promise<{ id: string; version: number }[]> {
    const refs: { id: string; version: number }[] = [];
    for (const id of new Set(ids ?? [])) {
      const artifact = await this.artifacts.get(id);
      if (artifact !== undefined) refs.push({ id: artifact.id, version: artifact.version });
    }
    return refs;
  }
}

function isTerminal(status: Run['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

function transitionRequestId(requestId: string, suffix: string): string {
  return `${requestId}:replay:${suffix}`.slice(0, 256);
}

function operationRequestId(runId: string, operation: PlatformRunOperation, suffix: string): string {
  const value = `platform:replay:${runId}:${operation.domain}:${operation.operation}:${suffix}`;
  return value.length <= 256 ? value : value.slice(0, 256);
}

function requiredString(input: Readonly<Record<string, unknown>>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.length === 0) throw invalidInput(`operation input '${key}' must be a non-empty string`);
  return value;
}

function optionalString(input: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) throw invalidInput(`operation input '${key}' must be a string`);
  return value;
}

function policyId(input: Readonly<Record<string, unknown>>, key: string, run: Run): string | undefined {
  return optionalString(input, key) ?? run.policy_decision_ids?.at(-1);
}

function optionalPositiveInt(input: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw invalidInput(`operation input '${key}' must be a positive integer`);
  return value;
}

function optionalNonnegativeInt(input: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw invalidInput(`operation input '${key}' must be a non-negative integer`);
  return value;
}

function optionalStringArray(input: Readonly<Record<string, unknown>>, key: string): string[] | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw invalidInput(`operation input '${key}' must be an array of strings`);
  }
  return value;
}

function requiredStringArray(input: Readonly<Record<string, unknown>>, key: string): string[] {
  const value = optionalStringArray(input, key);
  if (value === undefined || value.length === 0) throw invalidInput(`operation input '${key}' must be a non-empty array of strings`);
  return value;
}

function optionalRecord(input: Readonly<Record<string, unknown>>, key: string): Record<string, unknown> | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalidInput(`operation input '${key}' must be an object`);
  return value as Record<string, unknown>;
}

function policyDecisionIdFrom(error: unknown): string | undefined {
  if (!isError2(error)) return undefined;
  for (const key of ['policyDecisionId', 'policy_decision_id']) {
    const value = error.details?.[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function isPolicyRequired(error: unknown): boolean {
  return isError2(error) && error.code.endsWith('.policy_required');
}

function safeError(error: unknown): string {
  if (isError2(error)) return `${error.code}: ${error.message}`.slice(0, 2_000);
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

function invalidInput(message: string): Error2 {
  return new Error2(ErrorCodes.REQUEST_INVALID, message);
}

registerScopedService(
  LifecycleScope.Agent,
  IPlatformRunReplayService,
  PlatformRunReplayService,
  ScopeActivation.OnDemand,
  'platformRunReplay',
);
