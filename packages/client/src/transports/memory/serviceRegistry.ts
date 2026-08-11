/**
 * Service name → DI token registry for the in-process dispatcher. Only leaf
 * modules are imported (tokens + types) — never the engine root barrel, so
 * hosting klient in-process does not force the full registration side effects
 * beyond what the host already bootstrapped.
 */

import type { ServiceIdentifier } from '@spiderbyte/agent-core/_base/di/instantiation';
import { ISessionIndex } from '@spiderbyte/agent-core/app/sessionIndex/sessionIndex';
import { IWorkspaceService } from '@spiderbyte/agent-core/app/workspace/workspace';
import { IConfigService } from '@spiderbyte/agent-core/app/config/config';
import { IModelService } from '@spiderbyte/agent-core/kosong/model/model';
import { IModelCatalog } from '@spiderbyte/agent-core/kosong/model/catalog';
import { IProviderDiscoveryService } from '@spiderbyte/agent-core/app/kosongConfig/discovery';
import { IProviderService } from '@spiderbyte/agent-core/kosong/provider/provider';
import {
  IAuthSummaryService,
  IOAuthService,
} from '@spiderbyte/agent-core/app/auth/auth';
import { IFlagService } from '@spiderbyte/agent-core/app/flag/flag';
import { IPluginService } from '@spiderbyte/agent-core/app/plugin/plugin';
import { IBootstrapService } from '@spiderbyte/agent-core/app/bootstrap/bootstrap';
import { IEventService } from '@spiderbyte/agent-core/app/event/event';
import { IHostFolderBrowser } from '@spiderbyte/agent-core/app/hostFolderBrowser/hostFolderBrowser';
import { IWorkspaceLifecycleService } from '@spiderbyte/agent-core/app/workspaceLifecycle/workspaceLifecycle';
import { ISessionLifecycleService } from '@spiderbyte/agent-core/workspace/sessionLifecycle/sessionLifecycle';
import { ISessionMetadata } from '@spiderbyte/agent-core/session/sessionMetadata/sessionMetadata';
import { ISessionInteractionService } from '@spiderbyte/agent-core/session/interaction/interaction';
import { ISessionApprovalService } from '@spiderbyte/agent-core/session/approval/approval';
import { ISessionQuestionService } from '@spiderbyte/agent-core/session/question/question';
import { ISessionRunService } from '@spiderbyte/agent-core/session/run/run';
import { ISessionSkillCatalog } from '@spiderbyte/agent-core/session/sessionSkillCatalog/skillCatalog';
import { IAgentRPCService } from '@spiderbyte/agent-core/agent/rpc/rpc';
import { IAgentActivityView } from '@spiderbyte/agent-core/agent/activityView/activityView';
import { IAgentPlanService } from '@spiderbyte/agent-core/features/plan/plan';
import { IAgentProfileService } from '@spiderbyte/agent-core/agent/profile/profile';
import { IAgentShellCommandService } from '@spiderbyte/agent-core/agent/shellCommand/shellCommand';
import { IAgentTaskService } from '@spiderbyte/agent-core/agent/task/task';
import { IAgentUsageService } from '@spiderbyte/agent-core/agent/usage/usage';
import { IAgentMcpService } from '@spiderbyte/agent-core/agent/mcp/mcp';
import { IAgentFullCompactionService } from '@spiderbyte/agent-core/agent/fullCompaction/fullCompaction';
import { IPlatformModelBindingService } from '@spiderbyte/agent-core/agent/platformModelBinding/platformModelBinding';
import { IWorkspaceProviderConnectionService } from '@spiderbyte/agent-core/workspace/providerConnections/providerConnection';
import { IWorkspaceProviderRuntimeService } from '@spiderbyte/agent-core/workspace/providerConnections/providerRuntime';
import { IWorkspacePolicyService } from '@spiderbyte/agent-core/workspace/policy/policy';
import { IWorkspaceResourceService } from '@spiderbyte/agent-core/workspace/resources/resource';
import { IWorkspaceArtifactService } from '@spiderbyte/agent-core/workspace/artifacts/artifact';
import { IWorkspaceExecutionTargetService } from '@spiderbyte/agent-core/workspace/executionTargets/executionTarget';
import { IWorkspaceExecutionService } from '@spiderbyte/agent-core/workspace/execution/execution';
import { IWorkspaceAutomationService } from '@spiderbyte/agent-core/workspace/automations/automation';
import { IWorkspaceUsageService } from '@spiderbyte/agent-core/workspace/usage/usage';
import { IWorkspaceBudgetService } from '@spiderbyte/agent-core/workspace/budgets/budget';
import { IPlatformGovernanceService } from '@spiderbyte/agent-core/app/governance/governance';
import { IPlatformAuthorizationService } from '@spiderbyte/agent-core/app/authorization/authorization';
import { IPlatformPluginService } from '@spiderbyte/agent-core/app/platformPlugins/platformPlugins';
import { IWorkspacePlatformEventService } from '@spiderbyte/agent-core/workspace/platformEvents/platformEvents';
import { IWorkspaceDatasetService } from '@spiderbyte/agent-core/workspace/datasets/dataset';
import { IWorkspaceMlService } from '@spiderbyte/agent-core/workspace/ml/ml';
import { IWorkspacePipelineService } from '@spiderbyte/agent-core/workspace/pipelines/pipeline';
import { IWorkspaceServingService } from '@spiderbyte/agent-core/workspace/serving/serving';

/** Wire service name (decorator id string) → token. */
export const serviceTokens: Readonly<Record<string, ServiceIdentifier<unknown>>> = {
  sessionIndex: ISessionIndex,
  workspaceService: IWorkspaceService,
  configService: IConfigService,
  modelService: IModelService,
  modelResolver: IModelCatalog,
  providerDiscovery: IProviderDiscoveryService,
  providerService: IProviderService,
  oauthService: IOAuthService,
  authSummaryService: IAuthSummaryService,
  flagService: IFlagService,
  pluginService: IPluginService,
  providerConnectionService: IWorkspaceProviderConnectionService,
  providerRuntimeService: IWorkspaceProviderRuntimeService,
  policyService: IWorkspacePolicyService,
  resourceService: IWorkspaceResourceService,
  artifactService: IWorkspaceArtifactService,
  executionTargetService: IWorkspaceExecutionTargetService,
  executionService: IWorkspaceExecutionService,
  automationService: IWorkspaceAutomationService,
  workspaceUsageService: IWorkspaceUsageService,
  workspaceBudgetService: IWorkspaceBudgetService,
  platformGovernanceService: IPlatformGovernanceService,
  platformAuthorizationService: IPlatformAuthorizationService,
  platformPluginService: IPlatformPluginService,
  platformEvents: IWorkspacePlatformEventService,
  datasetService: IWorkspaceDatasetService,
  mlService: IWorkspaceMlService,
  pipelineService: IWorkspacePipelineService,
  servingService: IWorkspaceServingService,
  hostFolderBrowser: IHostFolderBrowser,
  bootstrapService: IBootstrapService,
  workspaceLifecycleService: IWorkspaceLifecycleService,
  sessionLifecycleService: ISessionLifecycleService,
  sessionMetadata: ISessionMetadata,
  sessionInteractionService: ISessionInteractionService,
  sessionApprovalService: ISessionApprovalService,
  sessionQuestionService: ISessionQuestionService,
  sessionRunService: ISessionRunService,
  sessionSkillCatalog: ISessionSkillCatalog,
  agentRPCService: IAgentRPCService,
  agentActivityView: IAgentActivityView,
  agentShellCommandService: IAgentShellCommandService,
  agentProfileService: IAgentProfileService,
  agentUsageService: IAgentUsageService,
  agentPlanService: IAgentPlanService,
  agentTaskService: IAgentTaskService,
  agentMcpService: IAgentMcpService,
  agentFullCompactionService: IAgentFullCompactionService,
  agentPlatformModelBindingService: IPlatformModelBindingService,
};

export { IEventService };
