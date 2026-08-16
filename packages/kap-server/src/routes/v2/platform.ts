/** Stable `/api/v2/workspaces/:workspace_id/platform/*` surface. */

import { timingSafeEqual } from 'node:crypto';

import {
  IWorkspaceArtifactService,
  IWorkspaceAutomationService,
  IWorkspaceExecutionTargetService,
  IWorkspaceDatasetService,
  IFlagService,
  IWorkspaceLifecycleService,
  IWorkspacePlatformEventService,
  IWorkspacePolicyService,
  IWorkspaceProviderConnectionService,
  IWorkspaceProviderRuntimeService,
  IWorkspaceUsageService,
  IWorkspaceBudgetService,
  IPlatformGovernanceService,
  IPlatformAuthorizationService,
  IPlatformPluginService,
  ProviderRuntimeError,
  ProviderRuntimeErrors,
  IWorkspaceResourceService,
  IWorkspaceService,
  IWorkspaceMlService,
  IWorkspacePipelineService,
  IWorkspaceServingService,
  type Scope,
} from '@spiderbyte/agent-core';
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
  executionTargetTestInputSchema,
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
  budgetConfigureInputSchema,
  budgetReserveInputSchema,
  budgetReleaseInputSchema,
  budgetReconcileInputSchema,
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
  organizationCreateInputSchema,
  hostedOrganizationSyncInputSchema,
  hostedProjectWorkspaceBindingInputSchema,
  organizationMemberUpsertInputSchema,
  projectCreateInputSchema,
  projectBindingCreateInputSchema,
  projectBindingRemoveInputSchema,
  projectMemberUpsertInputSchema,
  projectWorkspaceBindInputSchema,
  platformAuthorizationEvaluateInputSchema,
  platformPluginCommandInputSchema,
  platformPluginConfigureInputSchema,
  platformPluginDiscoverInputSchema,
  platformPluginInstallInputSchema,
} from '@spiderbyte/protocol';
import { z } from 'zod';

import { errEnvelope, okEnvelope } from '../../protocol/envelope';
import { ErrorCode } from '../../protocol/error-codes';
import { validationEnvelope } from '../../transport/errors';
import { mapPlatformError } from './platformErrors';
import {
  assertOrganizationAuthorization,
  assertProjectAuthorization,
  assertWorkspaceAuthorization,
  listAuthorizedOrganizations,
  listAuthorizedProjects,
  resolveLocalActorId,
} from '../../services/platformAuthorization';

interface PlatformRouteHost {
  get(path: string, options: { preHandler: unknown[] }, handler: PlatformHandler): unknown;
  post(path: string, options: { preHandler: unknown[] }, handler: PlatformHandler): unknown;
  patch(path: string, options: { preHandler: unknown[] }, handler: PlatformHandler): unknown;
}

interface PlatformRequest {
  readonly id: string;
  readonly method?: string;
  readonly url?: string;
  readonly params: unknown;
  readonly query: unknown;
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string | string[] | undefined>>;
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
const reservationParamsSchema = paramsSchema.extend({ reservation_id: z.string().min(1) });
const organizationParamsSchema = z.object({ organization_id: z.string().min(1) });
const projectParamsSchema = z.object({ project_id: z.string().min(1) });
const projectBindingParamsSchema = projectParamsSchema.extend({ binding_id: z.string().min(1) });
const pluginParamsSchema = z.object({ plugin_id: z.string().min(1) });

/**
 * Route handlers resolve the workspace lifecycle handle on every request. This
 * keeps the REST edge stateless while all stateful objects remain owned by the
 * workspace scope and its single canonical service instances.
 */
export function registerPlatformRoutes(app: PlatformRouteHost, core: Scope): void {
  const opts = { preHandler: [] };

  app.post('/authorization/evaluate', opts, async (req, reply) => {
    await authorizationRequest(req, reply, core, async (service) => {
      const input = platformAuthorizationEvaluateInputSchema.parse(withServerActor(req.body));
      const project = await assertProjectAuthorization(core, {
        projectId: input.project_id,
        workspaceId: input.workspace_id,
        requestId: req.id,
        capability: 'project.read',
      });
      if (project === undefined) return undefined;
      return service.evaluate(input);
    });
  });

  app.get('/plugins', opts, async (req, reply) => {
    await pluginRequest(req, reply, core, async (service) => {
      const query = z.strictObject({ project_id: z.string().min(1).optional() }).parse(req.query ?? {});
      if (query.project_id !== undefined) {
        const project = await assertProjectAuthorization(core, {
          projectId: query.project_id,
          requestId: req.id,
          capability: 'project.read',
        });
        return project === undefined ? undefined : service.list(project.id);
      }
      const projects = await listAuthorizedProjects(core);
      const plugins = await Promise.all(projects.map((project) => service.list(project.id)));
      return plugins.flat();
    });
  });
  app.get('/plugins/:plugin_id', opts, async (req, reply) => {
    await pluginRequest(req, reply, core, async (service, params) => {
      const plugin = await service.get(params.plugin_id);
      if (plugin === undefined) return undefined;
      await assertProjectAuthorization(core, {
        projectId: plugin.project_id,
        requestId: req.id,
        capability: 'project.read',
      });
      return plugin;
    }, pluginParamsSchema);
  });
  app.post('/plugins/discover', opts, async (req, reply) => {
    await pluginRequest(req, reply, core, (service) =>
      service.discover(platformPluginDiscoverInputSchema.parse(withServerActor(req.body))),
    );
  });
  app.post('/plugins', opts, async (req, reply) => {
    await pluginRequest(req, reply, core, (service) =>
      service.install(platformPluginInstallInputSchema.parse(withServerActor(req.body))),
    );
  });
  app.post('/plugins/:plugin_id/configure', opts, async (req, reply) => {
    await pluginRequest(req, reply, core, (service, params) =>
      service.configure(
        platformPluginConfigureInputSchema.parse(withServerActor(withPathField(req.body, 'plugin_id', params.plugin_id))),
      ), pluginParamsSchema);
  });
  app.post('/plugins/:plugin_id/command', opts, async (req, reply) => {
    await pluginRequest(req, reply, core, (service, params) =>
      service.command(
        platformPluginCommandInputSchema.parse(withServerActor(withPathField(req.body, 'plugin_id', params.plugin_id))),
      ), pluginParamsSchema);
  });

  app.get('/organizations', opts, async (req, reply) => {
    await governanceRequest(req, reply, core, z.object({}), () => listAuthorizedOrganizations(core));
  });
  app.post('/organizations', opts, async (req, reply) => {
    await governanceRequest(req, reply, core, z.object({}), (service) =>
      service.createOrganization(organizationCreateInputSchema.parse(withServerActor(req.body))),
    );
  });
  app.post('/organizations/local', opts, async (req, reply) => {
    await governanceRequest(req, reply, core, z.object({}), (service) => {
      z.strictObject({ actor_id: z.string().min(1).optional() }).parse(req.body ?? {});
      return service.ensureLocalOrganization(resolveLocalActorId());
    });
  });
  app.post('/internal/organizations/sync', opts, async (req, reply) => {
    if (!hasHostedOrganizationSyncAuthorization(req)) {
      reply.send(errEnvelope(ErrorCode.PLATFORM_POLICY_DENIED, 'hosted organization synchronization is not authorized', req.id));
      return;
    }
    await governanceRequest(req, reply, core, z.object({}), (service) =>
      service.synchronizeHostedOrganization(hostedOrganizationSyncInputSchema.parse(req.body)),
    );
  });
  app.post('/internal/projects/:project_id/workspaces/bind', opts, async (req, reply) => {
    if (!hasHostedOrganizationSyncAuthorization(req)) {
      reply.send(errEnvelope(ErrorCode.PLATFORM_POLICY_DENIED, 'hosted project/workspace binding is not authorized', req.id));
      return;
    }
    await governanceRequest(req, reply, core, projectParamsSchema, async (service, params) => {
      const input = hostedProjectWorkspaceBindingInputSchema.parse(
        withPathField(req.body, 'project_id', params.project_id),
      );
      const workspace = await core.accessor.get(IWorkspaceService).get(input.workspace_id);
      if (workspace === undefined) return undefined;
      return service.bindHostedWorkspace(input);
    });
  });
  app.get('/organizations/:organization_id', opts, async (req, reply) => {
    await governanceRequest(req, reply, core, organizationParamsSchema, async (_service, params) =>
      assertOrganizationAuthorization(core, { organizationId: params.organization_id, requestId: req.id }),
    );
  });
  app.get('/organizations/:organization_id/members', opts, async (req, reply) => {
    await governanceRequest(req, reply, core, organizationParamsSchema, async (service, params) => {
      const organization = await assertOrganizationAuthorization(core, {
        organizationId: params.organization_id,
        requestId: req.id,
      });
      if (organization === undefined) return undefined;
      return service.listOrganizationMembers(organization.id);
    });
  });
  app.post('/organizations/:organization_id/members', opts, async (req, reply) => {
    await governanceRequest(req, reply, core, organizationParamsSchema, (service, params) =>
      service.upsertOrganizationMember(
        organizationMemberUpsertInputSchema.parse(withServerActor(withPathField(req.body, 'organization_id', params.organization_id))),
      ),
    );
  });
  app.get('/organizations/:organization_id/projects', opts, async (req, reply) => {
    await governanceRequest(req, reply, core, organizationParamsSchema, async (_service, params) => {
      const organization = await assertOrganizationAuthorization(core, {
        organizationId: params.organization_id,
        requestId: req.id,
      });
      return organization === undefined ? undefined : listAuthorizedProjects(core, organization.id);
    });
  });
  app.get('/projects', opts, async (req, reply) => {
    await governanceRequest(req, reply, core, z.object({}), () => {
      const query = z.strictObject({ organization_id: z.string().min(1).optional() }).parse(req.query ?? {});
      return listAuthorizedProjects(core, query.organization_id);
    });
  });
  app.post('/projects', opts, async (req, reply) => {
    await governanceRequest(req, reply, core, z.object({}), (service) =>
      service.createProject(projectCreateInputSchema.parse(withServerActor(req.body))),
    );
  });
  app.get('/projects/:project_id', opts, async (req, reply) => {
    await governanceRequest(req, reply, core, projectParamsSchema, async (_service, params) =>
      assertProjectAuthorization(core, {
        projectId: params.project_id,
        requestId: req.id,
        capability: 'project.read',
      }),
    );
  });
  app.get('/projects/:project_id/members', opts, async (req, reply) => {
    await governanceRequest(req, reply, core, projectParamsSchema, async (service, params) => {
      const project = await assertProjectAuthorization(core, {
        projectId: params.project_id,
        requestId: req.id,
        capability: 'project.read',
      });
      return project === undefined ? undefined : service.listProjectMembers(project.id);
    });
  });
  app.post('/projects/:project_id/members', opts, async (req, reply) => {
    await governanceRequest(req, reply, core, projectParamsSchema, (service, params) =>
      service.upsertProjectMember(
        projectMemberUpsertInputSchema.parse(withServerActor(withPathField(req.body, 'project_id', params.project_id))),
      ),
    );
  });
  app.post('/projects/:project_id/workspaces', opts, async (req, reply) => {
    await governanceRequest(req, reply, core, projectParamsSchema, (service, params) =>
      service.bindWorkspace(params.project_id, projectWorkspaceBindInputSchema.parse(withServerActor(req.body))),
    );
  });
  app.get('/projects/:project_id/bindings', opts, async (req, reply) => {
    await governanceRequest(req, reply, core, projectParamsSchema, async (service, params) => {
      const project = await assertProjectAuthorization(core, {
        projectId: params.project_id,
        requestId: req.id,
        capability: 'project.read',
      });
      if (project === undefined) return undefined;
      const query = z.strictObject({ workspace_id: z.string().min(1).optional() }).parse(req.query ?? {});
      return service.listProjectBindings(project.id, query.workspace_id);
    });
  });
  app.post('/projects/:project_id/bindings', opts, async (req, reply) => {
    await governanceRequest(req, reply, core, projectParamsSchema, (service, params) =>
      service.bindProjectResource(
        projectBindingCreateInputSchema.parse(withServerActor(withPathField(req.body, 'project_id', params.project_id))),
      ),
    );
  });
  app.post('/projects/:project_id/bindings/:binding_id/revoke', opts, async (req, reply) => {
    await governanceRequest(req, reply, core, projectBindingParamsSchema, (service, params) =>
      service.removeProjectBinding(
        projectBindingRemoveInputSchema.parse(
          withServerActor(withPathField(withPathField(req.body, 'project_id', params.project_id), 'binding_id', params.binding_id)),
        ),
      ),
    );
  });
  app.get('/workspaces/:workspace_id/platform/project', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (_workspace, params) =>
      core.accessor.get(IPlatformGovernanceService).projectForWorkspace(params.workspace_id),
    );
  });

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
  app.post('/workspaces/:workspace_id/platform/execution-targets/:target_id/revoke', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, targetParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceExecutionTargetService).revoke(params.target_id, executionTargetCommandInputSchema.parse(req.body)),
    );
  });
  app.post('/workspaces/:workspace_id/platform/execution-targets/:target_id/test', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, targetParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceExecutionTargetService).test(params.target_id, executionTargetTestInputSchema.parse(req.body)),
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

  app.post('/workspaces/:workspace_id/platform/usage', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceUsageService).recordUsage(usageRecordCreateInputSchema.parse(withServerActor(req.body))),
    );
  });
  app.get('/workspaces/:workspace_id/platform/usage/summary', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceUsageService).usageSummary(usageSummaryQuerySchema.parse(req.query ?? {})),
    );
  });

  app.get('/workspaces/:workspace_id/platform/budgets', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceBudgetService).list(),
    );
  });
  app.get('/workspaces/:workspace_id/platform/budgets/status', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceBudgetService).status(),
    );
  });
  app.post('/workspaces/:workspace_id/platform/budgets', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceBudgetService).configure(budgetConfigureInputSchema.parse(withServerActor(req.body))),
    );
  });
  app.post('/workspaces/:workspace_id/platform/budgets/reservations', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, paramsSchema, async (accessor) =>
      accessor.get(IWorkspaceBudgetService).reserve(budgetReserveInputSchema.parse(withServerActor(req.body))),
    );
  });
  app.post('/workspaces/:workspace_id/platform/budgets/reservations/:reservation_id/release', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, reservationParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceBudgetService).release(
        budgetReleaseInputSchema.parse(withServerActor({ ...req.body as object, reservation_id: params.reservation_id })),
      ),
    );
  });
  app.post('/workspaces/:workspace_id/platform/budgets/reservations/:reservation_id/reconcile', opts, async (req, reply) => {
    await workspaceRequest(req, reply, core, reservationParamsSchema, async (accessor, params) =>
      accessor.get(IWorkspaceBudgetService).reconcile(
        budgetReconcileInputSchema.parse(withServerActor({ ...req.body as object, reservation_id: params.reservation_id })),
      ),
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

function withPathField(value: unknown, field: string, fieldValue: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { [field]: fieldValue };
  }
  return { ...(value as Record<string, unknown>), [field]: fieldValue };
}

function withServerActor(value: unknown): Record<string, unknown> {
  const body = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
  delete body['actor_id'];
  body['actor_id'] = resolveLocalActorId();
  return body;
}

function optionalStringFromObject(value: unknown, key: string): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' ? candidate : undefined;
}

function hasHostedOrganizationSyncAuthorization(req: PlatformRequest): boolean {
  const expected = process.env['SPIDERBYTE_PLATFORM_SYNC_SECRET'];
  const presentedValue = req.headers?.['x-spiderbyte-hosted-sync-secret'];
  const presented = Array.isArray(presentedValue) ? presentedValue[0] : presentedValue;
  if (expected === undefined || expected.length === 0 || presented === undefined) return false;
  const expectedBytes = Buffer.from(expected, 'utf8');
  const presentedBytes = Buffer.from(presented, 'utf8');
  return expectedBytes.length === presentedBytes.length && timingSafeEqual(expectedBytes, presentedBytes);
}

function platformCapabilityForRequest(req: PlatformRequest): import('@spiderbyte/protocol').PlatformCapability {
  const url = (req.url ?? '').split('?', 1)[0] ?? '';
  const method = req.method ?? 'GET';
  if (url.includes('/execution-targets')) return method === 'GET' ? 'workspace.read' : 'execution.execute';
  if (url.includes('/connections')) return method === 'GET' ? 'connection.read' : 'connection.manage';
  if (url.includes('/policy/decisions/') && /\/(approve|deny)$/.test(url)) return 'approval.grant';
  if (url.includes('/policy/decisions/') && url.endsWith('/audit')) return 'audit.read';
  if (url.includes('/policy')) {
    if (url.endsWith('/evaluate')) return 'workspace.read';
    return method === 'GET' ? 'workspace.read' : 'policy.manage';
  }
  if (url.includes('/budgets')) return method === 'GET' ? 'usage.read' : 'budget.manage';
  if (url.includes('/automations')) return url.endsWith('/fire') ? 'run.execute' : method === 'GET' ? 'workspace.read' : 'automation.manage';
  if (url.includes('/pipeline-runs/') && url.endsWith('/cancel')) return 'run.execute';
  if (url.includes('/pipelines/') && url.endsWith('/run')) return 'run.execute';
  if (url.includes('/pipelines') || url.includes('/pipeline-runs')) return method === 'GET' ? 'data.read' : 'data.write';
  if (url.includes('/ml/')) {
    if (method === 'GET') return 'data.read';
    if (url.includes('/train') || (url.includes('/training-runs/') && url.endsWith('/cancel'))) return 'execution.execute';
    return 'data.write';
  }
  if (url.includes('/serving/')) return method === 'GET' ? 'data.read' : 'execution.execute';
  if (url.includes('/datasets')) {
    if (method === 'GET' || url.endsWith('/query')) return 'data.read';
    return 'data.write';
  }
  if (url.includes('/artifacts')) return method === 'GET' ? 'data.read' : 'data.write';
  if (url.includes('/resources')) return url.endsWith('/execute') ? 'execution.execute' : method === 'GET' ? 'data.read' : 'data.write';
  return 'workspace.read';
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
    await assertWorkspaceAuthorization(core, {
      workspaceId,
      requestId: req.id,
      capability: platformCapabilityForRequest(req),
      executionTargetId:
        optionalStringFromObject(req.body, 'execution_target_id') ??
        optionalStringFromObject(req.body, 'target_id') ??
        optionalStringFromObject(params, 'target_id'),
    });
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

async function governanceRequest<TParams extends z.ZodTypeAny>(
  req: PlatformRequest,
  reply: PlatformReply,
  core: Scope,
  schema: TParams,
  operation: (
    service: IPlatformGovernanceService,
    params: z.infer<TParams>,
  ) => Promise<unknown>,
): Promise<void> {
  if (!core.accessor.get(IFlagService).enabled('platform_services')) {
    reply.send(errEnvelope(ErrorCode.PLATFORM_DISABLED, 'platform services are disabled', req.id));
    return;
  }

  try {
    const params = schema.parse(req.params);
    const data = await operation(core.accessor.get(IPlatformGovernanceService), params);
    if (data === undefined) {
      reply.send(errEnvelope(ErrorCode.PLATFORM_RESOURCE_NOT_FOUND, 'platform resource not found', req.id));
      return;
    }
    reply.send(okEnvelope(data, req.id));
  } catch (error) {
    if (error instanceof z.ZodError) {
      reply.send(
        validationEnvelope(
          error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
          req.id,
        ),
      );
      return;
    }
    reply.send(mapPlatformError(error, req.id));
  }
}

async function authorizationRequest(
  req: PlatformRequest,
  reply: PlatformReply,
  core: Scope,
  operation: (service: IPlatformAuthorizationService) => Promise<unknown>,
): Promise<void> {
  if (!core.accessor.get(IFlagService).enabled('platform_services')) {
    reply.send(errEnvelope(ErrorCode.PLATFORM_DISABLED, 'platform services are disabled', req.id));
    return;
  }
  try {
    const data = await operation(core.accessor.get(IPlatformAuthorizationService));
    if (data === undefined) {
      reply.send(errEnvelope(ErrorCode.PLATFORM_RESOURCE_NOT_FOUND, 'platform resource not found', req.id));
      return;
    }
    reply.send(okEnvelope(data, req.id));
  } catch (error) {
    if (error instanceof z.ZodError) {
      reply.send(
        validationEnvelope(
          error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
          req.id,
        ),
      );
      return;
    }
    reply.send(mapPlatformError(error, req.id));
  }
}

async function pluginRequest<TParams extends z.ZodTypeAny = z.ZodTypeAny>(
  req: PlatformRequest,
  reply: PlatformReply,
  core: Scope,
  operation: (
    service: IPlatformPluginService,
    params: z.infer<TParams>,
  ) => Promise<unknown>,
  schema?: TParams,
): Promise<void> {
  if (!core.accessor.get(IFlagService).enabled('platform_services')) {
    reply.send(errEnvelope(ErrorCode.PLATFORM_DISABLED, 'platform services are disabled', req.id));
    return;
  }
  try {
    const params = (schema === undefined ? {} : schema.parse(req.params)) as z.infer<TParams>;
    const data = await operation(core.accessor.get(IPlatformPluginService), params);
    if (data === undefined) {
      reply.send(errEnvelope(ErrorCode.PLATFORM_RESOURCE_NOT_FOUND, 'platform resource not found', req.id));
      return;
    }
    reply.send(okEnvelope(data, req.id));
  } catch (error) {
    if (error instanceof z.ZodError) {
      reply.send(
        validationEnvelope(
          error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
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
