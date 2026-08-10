/** Stable `/api/v2/workspaces/:workspace_id/platform/*` surface. */

import {
  IWorkspaceArtifactService,
  IWorkspaceAutomationService,
  IWorkspaceCommercialService,
  IWorkspaceExecutionTargetService,
  IWorkspaceDatasetService,
  IFlagService,
  IWorkspaceLifecycleService,
  IWorkspacePlatformEventService,
  IWorkspacePolicyService,
  IWorkspaceProviderConnectionService,
  IWorkspaceProviderRuntimeService,
  ProviderRuntimeError,
  ProviderRuntimeErrors,
  IWorkspaceResourceService,
  IWorkspaceService,
  IWorkspaceMlService,
  IWorkspacePipelineService,
  IWorkspaceServingService,
  type Scope,
} from '@moonshot-ai/agent-core-v2';
import {
  artifactCreateInputSchema,
  artifactDownloadRangeInputSchema,
  artifactExpireInputSchema,
  automationCreateInputSchema,
  automationFireInputSchema,
  automationUpdateInputSchema,
  executionLeaseAcquireInputSchema,
  executionLeaseReleaseInputSchema,
  executionTargetCommandInputSchema,
  executionTargetCreateInputSchema,
  executionTargetUpdateInputSchema,
  platformReplayQuerySchema,
  policyDecisionAuditInputSchema,
  policyDecisionResolveInputSchema,
  policyEvaluateInputSchema,
  policyRulesUpdateInputSchema,
  providerConnectionCommandInputSchema,
  providerConnectionCreateInputSchema,
  providerConnectionCreateWithSecretInputSchema,
  providerConnectionUpdateInputSchema,
  providerConnectionUpdateWithSecretInputSchema,
  resourceCreateInputSchema,
  resourceExecuteInputSchema,
  resourceTypeSchema,
  resourceUpdateInputSchema,
  usageRecordCreateInputSchema,
  usageSummaryQuerySchema,
  workspaceEntitlementUpdateInputSchema,
  workspaceMemberUpsertInputSchema,
  datasetCreateInputSchema,
  datasetProfileInputSchema,
  datasetQueryInputSchema,
  datasetTransformInputSchema,
  datasetVersionCreateInputSchema,
  experimentCreateInputSchema,
  trainingStartInputSchema,
  trainingCancelInputSchema,
  evaluationCreateInputSchema,
  experimentCompareInputSchema,
  modelRegisterInputSchema,
  modelStageInputSchema,
  analysisCreateInputSchema,
  pipelineCreateInputSchema,
  pipelineRunInputSchema,
  pipelineCancelInputSchema,
  modelPackageCreateInputSchema,
  servingEndpointCreateInputSchema,
  servingEndpointActionInputSchema,
} from '@moonshot-ai/protocol';
import { z } from 'zod';

import { errEnvelope, okEnvelope } from '../../protocol/envelope';
import { ErrorCode } from '../../protocol/error-codes';
import { validationEnvelope } from '../../transport/errors';
import { mapPlatformError } from './platformErrors';

interface PlatformRouteHost {
  get(path: string, options: { preHandler: unknown[] }, handler: PlatformHandler): unknown;
  post(path: string, options: { preHandler: unknown[] }, handler: PlatformHandler): unknown;
  patch(path: string, options: { preHandler: unknown[] }, handler: PlatformHandler): unknown;
}

interface PlatformRequest {
  readonly id: string;
  readonly params: unknown;
  readonly query: unknown;
  readonly body: unknown;
}

interface PlatformReply {
  send(payload: unknown): unknown;
}

type PlatformHandler = (req: PlatformRequest, reply: PlatformReply) => Promise<void>;
type WorkspaceAccessor = NonNullable<Awaited<ReturnType<typeof resolveWorkspace>>>;

const paramsSchema = z.object({ workspace_id: z.string().min(1) });
const connectionParamsSchema = paramsSchema.extend({ connection_id: z.string().min(1) });
const policyParamsSchema = paramsSchema.extend({ decision_id: z.string().min(1) });
const resourceParamsSchema = paramsSchema.extend({ resource_id: z.string().min(1) });
const artifactParamsSchema = paramsSchema.extend({ artifact_id: z.string().min(1) });
const targetParamsSchema = paramsSchema.extend({ target_id: z.string().min(1) });
const leaseParamsSchema = targetParamsSchema.extend({ lease_id: z.string().min(1) });
const automationParamsSchema = paramsSchema.extend({ automation_id: z.string().min(1) });
const datasetParamsSchema = paramsSchema.extend({ dataset_id: z.string().min(1) });
const experimentParamsSchema = paramsSchema.extend({ experiment_id: z.string().min(1) });
const trainingRunParamsSchema = paramsSchema.extend({ training_run_id: z.string().min(1) });
const evaluationParamsSchema = paramsSchema.extend({ evaluation_id: z.string().min(1) });
const modelParamsSchema = paramsSchema.extend({ model_id: z.string().min(1) });
const analysisParamsSchema = paramsSchema.extend({ analysis_id: z.string().min(1) });
const pipelineParamsSchema = paramsSchema.extend({ pipeline_id: z.string().min(1) });
const pipelineRunParamsSchema = paramsSchema.extend({ pipeline_run_id: z.string().min(1) });
const packageParamsSchema = paramsSchema.extend({ package_id: z.string().min(1) });
const endpointParamsSchema = paramsSchema.extend({ endpoint_id: z.string().min(1) });

/**
 * Route handlers resolve the workspace lifecycle handle on every request. This
 * keeps the REST edge stateless while all stateful objects remain owned by the
 * workspace scope and its single canonical service instances.
 */
export function registerPlatformRoutes(app: PlatformRouteHost, core: Scope): void {
  const opts = { preHandler: [] };

  app.get('/workspaces/:workspace_id/platform/connections', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceProviderConnectionService).list(),
    );
  });
  app.get('/workspaces/:workspace_id/platform/connections/:connection_id', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, connectionParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceProviderConnectionService).get(params.connection_id),
    );
  });
  app.post('/workspaces/:workspace_id/platform/connections', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) => {
      if (isSecretSetupBody(req.body)) {
        return accessor.get(IWorkspaceProviderRuntimeService).createConnection(
          providerConnectionCreateWithSecretInputSchema.parse(req.body),
        );
      }
      return accessor.get(IWorkspaceProviderConnectionService).create(
        providerConnectionCreateInputSchema.parse(req.body),
      );
    });
  });
  app.patch('/workspaces/:workspace_id/platform/connections/:connection_id', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, connectionParamsSchema, async (accessor, params) => {
      if (isSecretSetupBody(req.body)) {
        return accessor.get(IWorkspaceProviderRuntimeService).updateConnectionSecret(
          params.connection_id,
          providerConnectionUpdateWithSecretInputSchema.parse(req.body),
        );
      }
      return accessor.get(IWorkspaceProviderConnectionService).update(
        params.connection_id,
        providerConnectionUpdateInputSchema.parse(req.body),
      );
    });
  });
  registerConnectionCommand(app, core, opts, 'validate', 'validated', providerConnectionCommandInputSchema);
  registerConnectionCommand(app, core, opts, 'activate', 'activated', providerConnectionCommandInputSchema);
  registerConnectionCommand(app, core, opts, 'revoke', 'revoked', providerConnectionCommandInputSchema);
  app.get('/workspaces/:workspace_id/platform/connections/:connection_id/models', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, connectionParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceProviderRuntimeService).discoverModels(params.connection_id),
    );
  });

  app.get('/workspaces/:workspace_id/platform/policy/decisions', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspacePolicyService).list(),
    );
  });
  app.get('/workspaces/:workspace_id/platform/policy/decisions/:decision_id', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, policyParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspacePolicyService).get(params.decision_id),
    );
  });
  app.get('/workspaces/:workspace_id/platform/policy/decisions/:decision_id/explain', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, policyParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspacePolicyService).explain(params.decision_id),
    );
  });
  app.get('/workspaces/:workspace_id/platform/policy/rules', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspacePolicyService).rules(),
    );
  });
  app.patch('/workspaces/:workspace_id/platform/policy/rules', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspacePolicyService).setRules(policyRulesUpdateInputSchema.parse(req.body)),
    );
  });
  app.post('/workspaces/:workspace_id/platform/policy/evaluate', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspacePolicyService).evaluate(policyEvaluateInputSchema.parse(req.body)),
    );
  });
  registerPolicyCommand(app, core, opts, 'approve', (service, id, input) =>
    service.approve(id, input as z.infer<typeof policyDecisionResolveInputSchema>),
  );
  registerPolicyCommand(app, core, opts, 'deny', (service, id, input) =>
    service.deny(id, input as z.infer<typeof policyDecisionResolveInputSchema>),
  );
  registerPolicyCommand(app, core, opts, 'audit', (service, id, input) =>
    service.audit(id, input as z.infer<typeof policyDecisionAuditInputSchema>),
  );

  app.get('/workspaces/:workspace_id/platform/resources', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) => {
      const raw = z.object({ type: resourceTypeSchema.optional() }).parse(req.query ?? {});
      return accessor.get(IWorkspaceResourceService).list(raw['type']);
    });
  });
  app.get('/workspaces/:workspace_id/platform/resources/:resource_id', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, resourceParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceResourceService).get(params.resource_id),
    );
  });
  app.post('/workspaces/:workspace_id/platform/resources', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceResourceService).create(resourceCreateInputSchema.parse(req.body)),
    );
  });
  app.patch('/workspaces/:workspace_id/platform/resources/:resource_id', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, resourceParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceResourceService).update(params.resource_id, resourceUpdateInputSchema.parse(req.body)),
    );
  });
  app.post('/workspaces/:workspace_id/platform/resources/:resource_id/execute', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, resourceParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceResourceService).execute(params.resource_id, resourceExecuteInputSchema.parse(req.body)),
    );
  });
  app.post('/workspaces/:workspace_id/platform/resources/:resource_id/archive', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, resourceParamsSchema, async (accessor) =>
      accessor.get(IWorkspaceResourceService).archive(
        z.object({ resource_id: z.string() }).parse(req.params).resource_id,
        resourceUpdateInputSchema.parse(req.body),
      ),
    );
  });

  app.get('/workspaces/:workspace_id/platform/artifacts', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceArtifactService).list(),
    );
  });

  app.get('/workspaces/:workspace_id/platform/datasets', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceDatasetService).list(),
    );
  });
  app.get('/workspaces/:workspace_id/platform/datasets/:dataset_id', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, datasetParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceDatasetService).get(params.dataset_id),
    );
  });
  app.post('/workspaces/:workspace_id/platform/datasets', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceDatasetService).create(datasetCreateInputSchema.parse(req.body)),
    );
  });
  app.post('/workspaces/:workspace_id/platform/datasets/:dataset_id/versions', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, datasetParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceDatasetService).createVersion(
        params.dataset_id,
        datasetVersionCreateInputSchema.parse(req.body),
      ),
    );
  });
  app.post('/workspaces/:workspace_id/platform/datasets/:dataset_id/profile', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, datasetParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceDatasetService).profile(
        params.dataset_id,
        datasetProfileInputSchema.parse(req.body),
      ),
    );
  });
  app.post('/workspaces/:workspace_id/platform/datasets/:dataset_id/query', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, datasetParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceDatasetService).query(
        params.dataset_id,
        datasetQueryInputSchema.parse(req.body),
      ),
    );
  });
  app.post('/workspaces/:workspace_id/platform/datasets/:dataset_id/transform', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, datasetParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceDatasetService).transform(
        params.dataset_id,
        datasetTransformInputSchema.parse(req.body),
      ),
    );
  });

  app.get('/workspaces/:workspace_id/platform/ml/experiments', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceMlService).listExperiments(),
    );
  });
  app.get('/workspaces/:workspace_id/platform/ml/analyses', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceMlService).listAnalyses(),
    );
  });
  app.get('/workspaces/:workspace_id/platform/ml/analyses/:analysis_id', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, analysisParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceMlService).getAnalysis(params.analysis_id),
    );
  });
  app.post('/workspaces/:workspace_id/platform/ml/analyses', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceMlService).analyze(analysisCreateInputSchema.parse(req.body)),
    );
  });
  app.get('/workspaces/:workspace_id/platform/pipelines', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspacePipelineService).list(),
    );
  });
  app.get('/workspaces/:workspace_id/platform/pipelines/:pipeline_id', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, pipelineParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspacePipelineService).get(params.pipeline_id),
    );
  });
  app.post('/workspaces/:workspace_id/platform/pipelines', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspacePipelineService).create(pipelineCreateInputSchema.parse(req.body)),
    );
  });
  app.get('/workspaces/:workspace_id/platform/pipeline-runs', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) => {
      const query = z.object({ pipeline_id: z.string().min(1).optional() }).parse(req.query ?? {});
      return accessor.get(IWorkspacePipelineService).listRuns(query.pipeline_id);
    });
  });
  app.get('/workspaces/:workspace_id/platform/pipeline-runs/:pipeline_run_id', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, pipelineRunParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspacePipelineService).getRun(params.pipeline_run_id),
    );
  });
  app.post('/workspaces/:workspace_id/platform/pipelines/:pipeline_id/run', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, pipelineParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspacePipelineService).run(params.pipeline_id, pipelineRunInputSchema.parse(req.body)),
    );
  });
  app.post('/workspaces/:workspace_id/platform/pipeline-runs/:pipeline_run_id/cancel', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, pipelineRunParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspacePipelineService).cancelRun(params.pipeline_run_id, pipelineCancelInputSchema.parse(req.body)),
    );
  });

  app.get('/workspaces/:workspace_id/platform/serving/packages', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceServingService).listPackages(),
    );
  });
  app.get('/workspaces/:workspace_id/platform/serving/packages/:package_id', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, packageParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceServingService).getPackage(params.package_id),
    );
  });
  app.post('/workspaces/:workspace_id/platform/serving/packages', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceServingService).createPackage(modelPackageCreateInputSchema.parse(req.body)),
    );
  });
  app.get('/workspaces/:workspace_id/platform/serving/endpoints', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceServingService).listEndpoints(),
    );
  });
  app.get('/workspaces/:workspace_id/platform/serving/endpoints/:endpoint_id', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, endpointParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceServingService).getEndpoint(params.endpoint_id),
    );
  });
  app.post('/workspaces/:workspace_id/platform/serving/endpoints', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceServingService).deploy(servingEndpointCreateInputSchema.parse(req.body)),
    );
  });
  app.post('/workspaces/:workspace_id/platform/serving/endpoints/:endpoint_id/:action', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, endpointParamsSchema.extend({ action: z.enum(['pause', 'resume', 'archive', 'rollback']) }), async (accessor, params) =>
      accessor.get(IWorkspaceServingService).action(
        params.endpoint_id,
        params.action,
        servingEndpointActionInputSchema.parse(req.body),
      ),
    );
  });
  app.get('/workspaces/:workspace_id/platform/ml/experiments/:experiment_id', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, experimentParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceMlService).getExperiment(params.experiment_id),
    );
  });
  app.post('/workspaces/:workspace_id/platform/ml/experiments', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceMlService).createExperiment(experimentCreateInputSchema.parse(req.body)),
    );
  });
  app.post('/workspaces/:workspace_id/platform/ml/experiments/:experiment_id/validate', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, experimentParamsSchema, async (accessor, params) => {
      const input = z.object({ request_id: z.string().min(1) }).parse(req.body);
      return accessor.get(IWorkspaceMlService).validateExperiment(params.experiment_id, input.request_id);
    });
  });
  app.get('/workspaces/:workspace_id/platform/ml/training-runs', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) => {
      const query = z.object({ experiment_id: z.string().min(1).optional() }).parse(req.query ?? {});
      return accessor.get(IWorkspaceMlService).listTrainingRuns(query.experiment_id);
    });
  });
  app.get('/workspaces/:workspace_id/platform/ml/training-runs/:training_run_id', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, trainingRunParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceMlService).getTrainingRun(params.training_run_id),
    );
  });
  app.post('/workspaces/:workspace_id/platform/ml/experiments/:experiment_id/train', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, experimentParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceMlService).startTraining(
        params.experiment_id,
        trainingStartInputSchema.parse(req.body),
      ),
    );
  });
  app.post('/workspaces/:workspace_id/platform/ml/training-runs/:training_run_id/cancel', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, trainingRunParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceMlService).cancelTraining(
        params.training_run_id,
        trainingCancelInputSchema.parse(req.body),
      ),
    );
  });
  app.get('/workspaces/:workspace_id/platform/ml/evaluations', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) => {
      const query = z.object({ experiment_id: z.string().min(1).optional() }).parse(req.query ?? {});
      return accessor.get(IWorkspaceMlService).listEvaluations(query.experiment_id);
    });
  });
  app.get('/workspaces/:workspace_id/platform/ml/evaluations/:evaluation_id', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, evaluationParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceMlService).getEvaluation(params.evaluation_id),
    );
  });
  app.post('/workspaces/:workspace_id/platform/ml/evaluations', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceMlService).evaluate(evaluationCreateInputSchema.parse(req.body)),
    );
  });
  app.post('/workspaces/:workspace_id/platform/ml/comparisons', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceMlService).compare(experimentCompareInputSchema.parse(req.body)),
    );
  });
  app.get('/workspaces/:workspace_id/platform/ml/models', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) => {
      const query = z.object({ model_name: z.string().min(1).optional() }).parse(req.query ?? {});
      return accessor.get(IWorkspaceMlService).listModels(query.model_name);
    });
  });
  app.get('/workspaces/:workspace_id/platform/ml/models/:model_id', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, modelParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceMlService).getModel(params.model_id),
    );
  });
  app.post('/workspaces/:workspace_id/platform/ml/models', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceMlService).registerModel(modelRegisterInputSchema.parse(req.body)),
    );
  });
  app.post('/workspaces/:workspace_id/platform/ml/models/:model_id/stage', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, modelParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceMlService).updateModelStage(
        params.model_id,
        modelStageInputSchema.parse(req.body),
      ),
    );
  });

  app.get('/workspaces/:workspace_id/platform/artifacts/:artifact_id', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, artifactParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceArtifactService).get(params.artifact_id),
    );
  });
  app.post('/workspaces/:workspace_id/platform/artifacts', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceArtifactService).create(artifactCreateInputSchema.parse(req.body)),
    );
  });
  app.get('/workspaces/:workspace_id/platform/artifacts/:artifact_id/download', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, artifactParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceArtifactService).download(params.artifact_id),
    );
  });
  app.get('/workspaces/:workspace_id/platform/artifacts/:artifact_id/download/range', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, artifactParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceArtifactService).downloadRange(
        params.artifact_id,
        artifactDownloadRangeInputSchema.parse(req.query ?? {}),
      ),
    );
  });
  app.get('/workspaces/:workspace_id/platform/artifacts/:artifact_id/lineage', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, artifactParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceArtifactService).lineage(params.artifact_id),
    );
  });
  app.post('/workspaces/:workspace_id/platform/artifacts/:artifact_id/expire', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, artifactParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceArtifactService).expire(params.artifact_id, artifactExpireInputSchema.parse(req.body)),
    );
  });

  app.get('/workspaces/:workspace_id/platform/execution-targets', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceExecutionTargetService).list(),
    );
  });
  app.get('/workspaces/:workspace_id/platform/execution-targets/:target_id', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, targetParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceExecutionTargetService).get(params.target_id),
    );
  });
  app.post('/workspaces/:workspace_id/platform/execution-targets', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceExecutionTargetService).register(executionTargetCreateInputSchema.parse(req.body)),
    );
  });
  app.patch('/workspaces/:workspace_id/platform/execution-targets/:target_id', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, targetParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceExecutionTargetService).update(params.target_id, executionTargetUpdateInputSchema.parse(req.body)),
    );
  });
  app.post('/workspaces/:workspace_id/platform/execution-targets/:target_id/ready', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, targetParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceExecutionTargetService).markReady(params.target_id, executionTargetCommandInputSchema.parse(req.body)),
    );
  });
  app.post('/workspaces/:workspace_id/platform/execution-targets/:target_id/disable', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, targetParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceExecutionTargetService).disable(params.target_id, executionTargetCommandInputSchema.parse(req.body)),
    );
  });
  app.post('/workspaces/:workspace_id/platform/execution-targets/:target_id/leases', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, targetParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceExecutionTargetService).acquireLease(params.target_id, executionLeaseAcquireInputSchema.parse(req.body)),
    );
  });
  app.post('/workspaces/:workspace_id/platform/execution-targets/:target_id/leases/:lease_id/release', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, leaseParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceExecutionTargetService).releaseLease(
        params.target_id,
        params.lease_id,
        executionLeaseReleaseInputSchema.parse(req.body),
      ),
    );
  });

  app.get('/workspaces/:workspace_id/platform/automations', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceAutomationService).list(),
    );
  });
  app.get('/workspaces/:workspace_id/platform/automations/:automation_id', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, automationParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceAutomationService).get(params.automation_id),
    );
  });
  app.get('/workspaces/:workspace_id/platform/automations/:automation_id/history', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, automationParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceAutomationService).history(params.automation_id),
    );
  });
  app.post('/workspaces/:workspace_id/platform/automations', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceAutomationService).create(automationCreateInputSchema.parse(req.body)),
    );
  });
  app.patch('/workspaces/:workspace_id/platform/automations/:automation_id', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, automationParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceAutomationService).update(params.automation_id, automationUpdateInputSchema.parse(req.body)),
    );
  });
  app.post('/workspaces/:workspace_id/platform/automations/:automation_id/fire', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, automationParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceAutomationService).fire(params.automation_id, automationFireInputSchema.parse(req.body)),
    );
  });

  app.get('/workspaces/:workspace_id/platform/commercial/members', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceCommercialService).listMembers(),
    );
  });
  app.post('/workspaces/:workspace_id/platform/commercial/members', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceCommercialService).upsertMember(workspaceMemberUpsertInputSchema.parse(req.body)),
    );
  });
  app.get('/workspaces/:workspace_id/platform/commercial/entitlements', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceCommercialService).listEntitlements(),
    );
  });
  app.post('/workspaces/:workspace_id/platform/commercial/entitlements', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceCommercialService).setEntitlement(workspaceEntitlementUpdateInputSchema.parse(req.body)),
    );
  });
  app.post('/workspaces/:workspace_id/platform/commercial/usage', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceCommercialService).recordUsage(usageRecordCreateInputSchema.parse(req.body)),
    );
  });
  app.get('/workspaces/:workspace_id/platform/commercial/usage/summary', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceCommercialService).usageSummary(usageSummaryQuerySchema.parse(req.query ?? {})),
    );
  });

  app.get('/workspaces/:workspace_id/platform/events', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) => {
      const query = platformReplayQuerySchema.parse(req.query ?? {});
      return accessor.get(IWorkspacePlatformEventService).replay(query.after_sequence, query.limit);
    });
  });
}

function registerConnectionCommand(
  app: PlatformRouteHost,
  core: Scope,
  opts: { preHandler: unknown[] },
  action: 'validate' | 'activate' | 'revoke',
  _event: string,
  schema: typeof providerConnectionCommandInputSchema,
): void {
  app.post(`/workspaces/:workspace_id/platform/connections/:connection_id/${action}`, opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, connectionParamsSchema, async (accessor, params) => {
      const service = accessor.get(IWorkspaceProviderConnectionService);
      const input = schema.parse(req.body);
      if (action === 'validate') {
        const validation = await accessor
          .get(IWorkspaceProviderRuntimeService)
          .validate(params.connection_id);
        if (!validation.ok) {
          throw new ProviderRuntimeError(
            ProviderRuntimeErrors.codes.PROVIDER_RUNTIME_REQUEST_FAILED,
            validation.error ?? 'provider validation failed',
            { connectionId: params.connection_id, model: validation.model },
          );
        }
      }
      return action === 'validate'
        ? service.validate(params.connection_id, input)
        : action === 'activate'
          ? service.activate(params.connection_id, input)
          : accessor.get(IWorkspaceProviderRuntimeService).revokeConnection(params.connection_id, input);
    });
  });
}

function isSecretSetupBody(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && 'secret' in value;
}

function registerPolicyCommand(
  app: PlatformRouteHost,
  core: Scope,
  opts: { preHandler: unknown[] },
  action: 'approve' | 'deny' | 'audit',
  invoke: (
    service: IWorkspacePolicyService,
    id: string,
    input: unknown,
  ) => Promise<unknown>,
): void {
  app.post(`/workspaces/:workspace_id/platform/policy/decisions/:decision_id/${action}`, opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, policyParamsSchema, async (accessor, params) => {
      const service = accessor.get(IWorkspacePolicyService);
      const input = action === 'audit'
        ? policyDecisionAuditInputSchema.parse(req.body)
        : policyDecisionResolveInputSchema.parse(req.body);
      return invoke(service, params.decision_id, input);
    });
  });
}

async function workspaceRequest<TParams extends z.ZodTypeAny>(
  req: PlatformRequest,
  reply: PlatformReply,
  core: Scope,
  schema: TParams,
  operation: (accessor: WorkspaceAccessor, params: z.infer<TParams>) => Promise<unknown>,
): Promise<void> {
  if (!core.accessor.get(IFlagService).enabled('platform_services')) {
    reply.send(
      errEnvelope(
        ErrorCode.PLATFORM_DISABLED,
        'platform services are disabled',
        req.id,
      ),
    );
    return;
  }

  try {
    const params = schema.parse(req.params);
    const workspaceId = (params as { workspace_id: string }).workspace_id;
    const workspace = await resolveWorkspace(core, workspaceId);
    if (workspace === undefined) {
      reply.send(errEnvelope(ErrorCode.WORKSPACE_NOT_FOUND, 'workspace not found', req.id));
      return;
    }
    const data = await operation(workspace, params);
    if (data === undefined) {
      reply.send(
        errEnvelope(
          ErrorCode.PLATFORM_RESOURCE_NOT_FOUND,
          'platform resource not found',
          req.id,
        ),
      );
      return;
    }
    reply.send(okEnvelope(data, req.id));
  } catch (error) {
    if (error instanceof z.ZodError) {
      reply.send(
        validationEnvelope(
          error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
          req.id,
        ),
      );
      return;
    }
    reply.send(mapPlatformError(error, req.id));
  }
}

async function resolveWorkspace(core: Scope, workspaceId: string) {
  const catalog = core.accessor.get(IWorkspaceService);
  const workspace = await catalog.get(workspaceId);
  if (workspace === undefined) return undefined;
  const handle = await core.accessor.get(IWorkspaceLifecycleService).handlerFor({
    workspaceId,
    root: workspace.root,
  });
  return handle.accessor;
}
