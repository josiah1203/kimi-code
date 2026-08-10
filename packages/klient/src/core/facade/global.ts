/**
 * The `global` facade — aggregated, single-object-param methods over the
 * engine's app-scope services. Each method maps to one underlying service
 * call (except `env()`, which fans out and merges); the `Caller` underneath
 * applies contract validation and hands the call to the transport. Facade
 * code never sees service tokens, scope routing, or transport details.
 */

import type {
  SessionListQuery,
  SessionSummary,
} from '@moonshot-ai/agent-core-v2/app/sessionIndex/sessionIndex';
import type { SessionMeta } from '@moonshot-ai/agent-core-v2/session/sessionMetadata/sessionMetadata';
import type { Page } from '@moonshot-ai/agent-core-v2/persistence/interface/queryStore';
import type {
  Workspace,
  WorkspaceUpdate,
} from '@moonshot-ai/agent-core-v2/app/workspace/workspace';
import type {
  ConfigDiagnostic,
  ConfigInspectValue,
  ConfigTarget,
} from '@moonshot-ai/agent-core-v2/app/config/config';
import type { ProviderConfig } from '@moonshot-ai/agent-core-v2/kosong/provider/provider';
import type {
  AuthStatus,
  IOAuthService,
} from '@moonshot-ai/agent-core-v2/app/auth/auth';
import type { ExperimentalFeatureState } from '@moonshot-ai/agent-core-v2/app/flag/flag';
import type {
  FsBrowseResponse,
  FsHomeResponse,
} from '@moonshot-ai/agent-core-v2/app/hostFolderBrowser/hostFolderBrowser';
import type { ModelRecord } from '@moonshot-ai/agent-core-v2/kosong/model/model';
import type { IModelCatalog } from '@moonshot-ai/agent-core-v2/kosong/model/catalog';
import type { IProviderDiscoveryService } from '@moonshot-ai/agent-core-v2/app/kosongConfig/discovery';

import type { EventSourceRef, IDisposable } from '../channel.js';
import type { McpServerConfig } from '../../contract/mcp.js';
import type { AnonymousProviderInput, GenerateEvent, GenerateInput, GenerateParams, ProviderInput } from './kosong-types.js';
import { platformLifecycleEventSchema } from '@moonshot-ai/protocol';
import type {
  PluginCommandDef,
  PluginInfo,
  PluginSummary,
  PluginUpdateStatus,
  ReloadSummary,
} from '@moonshot-ai/agent-core-v2/app/plugin/types';
import type { CapabilityStatus } from '@moonshot-ai/agent-core-v2/app/capability/types';
import type {
  Artifact,
  Budget,
  BudgetConfigureInput,
  BudgetReconcileInput,
  BudgetReleaseInput,
  BudgetReservation,
  BudgetReservationResult,
  BudgetReserveInput,
  BudgetStatus,
  Analysis,
  AnalysisCreateInput,
  ArtifactDownloadChunk,
  ArtifactCreateInput,
  ArtifactDownload,
  ArtifactDownloadRangeInput,
  ArtifactExpireInput,
  ArtifactKind,
  ArtifactLineage,
  Automation,
  AutomationCreateInput,
  AutomationFireInput,
  AutomationFireResult,
  AutomationUpdateInput,
  Dataset,
  DatasetCreateInput,
  DatasetProfile,
  DatasetProfileInput,
  DatasetQueryInput,
  DatasetQueryResult,
  DatasetTransformInput,
  DatasetVersionCreateInput,
  Evaluation,
  EvaluationCreateInput,
  Experiment,
  ExperimentComparison,
  ExperimentCompareInput,
  ExperimentCreateInput,
  ModelRegisterInput,
  ModelStageInput,
  ModelVersion,
  Pipeline,
  PipelineCancelInput,
  PipelineCreateInput,
  PipelineRun,
  PipelineRunInput,
  ModelPackage,
  ModelPackageCreateInput,
  ServingEndpoint,
  ServingEndpointActionInput,
  ServingEndpointCreateInput,
  TrainingCancelInput,
  TrainingRun,
  TrainingStartInput,
  ExecutionLease,
  ExecutionLeaseAcquireInput,
  ExecutionLeaseReleaseInput,
  ExecutionTarget,
  ExecutionTargetCommandInput,
  ExecutionTargetCreateInput,
  ExecutionTargetUpdateInput,
  PlatformReplayPage,
  PlatformLifecycleEvent,
  PlatformEntityType,
  PolicyDecision,
  PolicyDecisionAuditInput,
  PolicyDecisionResolveInput,
  PolicyEvaluateInput,
  PolicyRule,
  PolicyRulesUpdateInput,
  ProviderConnection,
  ProviderConnectionCommandInput,
  ProviderConnectionCreateInput,
  ProviderConnectionCreateWithSecretInput,
  ProviderConnectionUpdateInput,
  ProviderConnectionUpdateWithSecretInput,
  ProviderModelDiscovery,
  Resource,
  ResourceCreateInput,
  ResourceExecuteInput,
  ResourceExecution,
  ResourceType,
  ResourceUpdateInput,
  UsageRecord,
  UsageRecordCreateInput,
  UsageSummary,
  UsageSummaryQuery,
  WorkspaceEntitlement,
  WorkspaceEntitlementUpdateInput,
  WorkspaceMember,
  WorkspaceMemberUpsertInput,
  Organization,
  OrganizationCreateInput,
  OrganizationMember,
  OrganizationMemberUpsertInput,
  Project,
  ProjectBinding,
  ProjectBindingCreateInput,
  ProjectBindingRemoveInput,
  ProjectCreateInput,
  ProjectMember,
  ProjectMemberUpsertInput,
  ProjectWorkspaceBindInput,
  PlatformIdentityDevicePollInput,
  PlatformIdentityDevicePollResult,
  PlatformIdentityDeviceStart,
  PlatformIdentityLogoutResult,
  PlatformIdentityPkceCompleteInput,
  PlatformIdentityPkceStart,
  PlatformIdentityStatus,
  PlatformAuthorizationDecision,
  PlatformAuthorizationEvaluateInput,
  PlatformPlugin,
  PlatformPluginCommandInput,
  PlatformPluginConfigureInput,
  PlatformPluginDiscoverInput,
  PlatformPluginInstallInput,
  PlatformPluginManifest,
} from '@moonshot-ai/protocol';

/** Low-level caller the klient factory builds: routes + validates one service call. */
export type Caller = (service: string, method: string, args: unknown[]) => Promise<unknown>;

/** Scoped variant — the factory's real signature; global methods bind the core scope. */
export type ScopedCaller = (
  scope: { readonly workspaceId?: string; readonly sessionId?: string; readonly agentId?: string },
  service: string,
  method: string,
  args: unknown[],
) => Promise<unknown>;

/** Streaming variant of `ScopedCaller` — returns a validated `AsyncIterable`. */
export type ScopedStreamCaller = (
  scope: { readonly workspaceId?: string; readonly sessionId?: string; readonly agentId?: string },
  service: string,
  method: string,
  args: unknown[],
) => AsyncIterable<unknown>;

/** Streaming event subscription variant used by workspace-scoped facades. */
export type ScopedListenCaller = (
  scope: { readonly workspaceId?: string; readonly sessionId?: string; readonly agentId?: string },
  source: EventSourceRef,
  handler: (data: unknown) => void,
  onError?: (error: Error) => void,
) => IDisposable;

// ---------------------------------------------------------------------------
// Wire-type aliases for shapes the engine sources from `@moonshot-ai/protocol`
// (not a direct klient dependency) — derived through the service interfaces.
// ---------------------------------------------------------------------------

export type RefreshProviderModelsResponse = Awaited<
  ReturnType<IOAuthService['refreshOAuthProviderModels']>
>;
export type OAuthFlowStart = Awaited<ReturnType<IOAuthService['startLogin']>>;
export type OAuthFlowSnapshot = NonNullable<Awaited<ReturnType<IOAuthService['getFlow']>>>;
export type OAuthLoginCancelResponse = Awaited<ReturnType<IOAuthService['cancelLogin']>>;
export type OAuthLogoutResponse = Awaited<ReturnType<IOAuthService['logout']>>;

export type ModelCatalogItem = Awaited<ReturnType<IModelCatalog['listModels']>>[number];
export type ProviderCatalogItem = Awaited<
  ReturnType<IModelCatalog['listProviders']>
>[number];
export type SetDefaultModelResponse = Awaited<
  ReturnType<IModelCatalog['setDefaultModel']>
>;
export type RefreshProviderModelsOptions = NonNullable<
  Parameters<IProviderDiscoveryService['refreshProviderModels']>[0]
>;

/** String-literal form of the engine's `ConfigTarget` enum, so consumers never import the enum value. */
export type ConfigTargetLiteral = `${ConfigTarget}`;

// ---------------------------------------------------------------------------
// Facade interfaces
// ---------------------------------------------------------------------------

export interface GlobalSessionsFacade {
  list(query: SessionListQuery): Promise<Page<SessionSummary>>;
  get(id: string): Promise<SessionSummary | undefined>;
  countActive(workspaceIds: readonly string[]): Promise<number>;
  /**
   * Create a session rooted at `workDir` (the workspace is registered
   * implicitly), optionally titled. Returns the persisted metadata. No agent
   * is created — `session(id).agent('main')` materializes it on first use.
   * `mcpServers` injects ephemeral per-session MCP servers: connected only
   * for this session, never persisted.
   */
  create(input: {
    workDir: string;
    additionalDirs?: readonly string[];
    title?: string;
    mcpServers?: Readonly<Record<string, McpServerConfig>>;
  }): Promise<SessionMeta>;
}

export interface GlobalWorkspacesFacade {
  list(): Promise<readonly Workspace[]>;
  get(id: string): Promise<Workspace | undefined>;
  createOrTouch(input: { root: string; name?: string }): Promise<Workspace>;
  update(input: { id: string; patch: WorkspaceUpdate }): Promise<Workspace | undefined>;
  delete(id: string): Promise<void>;
}

export interface GlobalConfigFacade {
  get<T = unknown>(domain: string): Promise<T>;
  getAll(): Promise<Record<string, unknown>>;
  inspect<T = unknown>(domain: string): Promise<ConfigInspectValue<T>>;
  set(input: { domain: string; patch: unknown; target?: ConfigTargetLiteral }): Promise<void>;
  replace(input: {
    domain: string;
    value: unknown;
    target?: ConfigTargetLiteral;
  }): Promise<void>;
  /**
   * Replace several domains in ONE atomic write (the engine's
   * `IConfigService.replaceSections`): a domain mapped to `undefined` is
   * cleared, domains absent from `sections` are left untouched.
   */
  replaceSections(input: {
    sections: Record<string, unknown>;
    target?: ConfigTargetLiteral;
  }): Promise<void>;
  reload(): Promise<void>;
  diagnostics(): Promise<readonly ConfigDiagnostic[]>;
}

export interface GlobalKosongFacade {
  // -- Provider ---------------------------------------------------------
  listProviders(): Promise<readonly ProviderCatalogItem[]>;
  getProvider(id: string): Promise<ProviderCatalogItem>;
  /** Add a named provider (string id + config) or an anonymous single-model provider (object). */
  addProvider(id: string, config: ProviderInput): Promise<void>;
  addProvider(config: AnonymousProviderInput): Promise<void>;
  removeProvider(id: string): Promise<void>;
  refreshProviders(opts?: RefreshProviderModelsOptions): Promise<RefreshProviderModelsResponse>;

  // -- Model ------------------------------------------------------------
  listModels(): Promise<readonly ModelCatalogItem[]>;
  setDefaultModel(id: string): Promise<SetDefaultModelResponse>;

  // -- Generate (streaming) -----------------------------------------------
  generate(
    modelId: string,
    input: GenerateInput,
    params?: GenerateParams,
  ): AsyncIterable<GenerateEvent>;
}

export interface GlobalAuthFacade {
  status(provider?: string): Promise<AuthStatus>;
  summarize(): Promise<readonly AuthStatus[]>;
  /**
   * The engine's own auth-readiness probe for a model (the default model when
   * omitted): resolves config-file apiKey / provider env-bag credentials or an
   * OAuth token, throwing a typed auth error when nothing resolves. Actual
   * model usage does not depend on the OAuth-only {@link summarize} view.
   */
  ensureReady(modelOverride?: string): Promise<void>;
  startLogin(provider?: string): Promise<OAuthFlowStart>;
  flow(provider?: string): Promise<OAuthFlowSnapshot | undefined>;
  cancelLogin(provider?: string): Promise<OAuthLoginCancelResponse>;
  logout(provider?: string): Promise<OAuthLogoutResponse>;
  /**
   * @deprecated Use `kosong.refreshProviders({ scope: 'oauth' })` — the
   * kosong facade owns provider-model refresh; this alias remains for one
   * release cycle.
   */
  refreshProviderModels(): Promise<RefreshProviderModelsResponse>;
}

export interface GlobalFlagsFacade {
  list(): Promise<readonly ExperimentalFeatureState[]>;
  enabled(id: string): Promise<boolean>;
  enabledIds(): Promise<readonly string[]>;
  explain(id: string): Promise<ExperimentalFeatureState | undefined>;
  snapshot(): Promise<Record<string, boolean>>;
}

export interface GlobalCapabilitiesFacade {
  list(): Promise<readonly CapabilityStatus[]>;
  get(id: string): Promise<CapabilityStatus>;
  install(id: string): Promise<CapabilityStatus>;
}

export interface GlobalProviderConnectionsFacade {
  list(workspaceId: string): Promise<readonly ProviderConnection[]>;
  get(workspaceId: string, id: string): Promise<ProviderConnection | undefined>;
  create(workspaceId: string, input: ProviderConnectionCreateInput): Promise<ProviderConnection>;
  createWithSecret(workspaceId: string, input: ProviderConnectionCreateWithSecretInput): Promise<ProviderConnection>;
  update(workspaceId: string, id: string, input: ProviderConnectionUpdateInput): Promise<ProviderConnection | undefined>;
  updateSecret(workspaceId: string, id: string, input: ProviderConnectionUpdateWithSecretInput): Promise<ProviderConnection | undefined>;
  validate(workspaceId: string, id: string, input: ProviderConnectionCommandInput): Promise<ProviderConnection | undefined>;
  activate(workspaceId: string, id: string, input: ProviderConnectionCommandInput): Promise<ProviderConnection | undefined>;
  revoke(workspaceId: string, id: string, input: ProviderConnectionCommandInput): Promise<ProviderConnection | undefined>;
  discoverModels(workspaceId: string, id: string): Promise<ProviderModelDiscovery | undefined>;
}

export interface GlobalDatasetFacade {
  list(workspaceId: string): Promise<readonly Dataset[]>;
  get(workspaceId: string, id: string): Promise<Dataset | undefined>;
  create(workspaceId: string, input: DatasetCreateInput): Promise<Dataset>;
  createVersion(workspaceId: string, id: string, input: DatasetVersionCreateInput): Promise<Dataset | undefined>;
  profile(workspaceId: string, id: string, input: DatasetProfileInput): Promise<DatasetProfile | undefined>;
  query(workspaceId: string, id: string, input: DatasetQueryInput): Promise<DatasetQueryResult | undefined>;
  transform(workspaceId: string, id: string, input: DatasetTransformInput): Promise<Dataset | undefined>;
}

export interface GlobalMlFacade {
  listAnalyses(workspaceId: string): Promise<readonly Analysis[]>;
  getAnalysis(workspaceId: string, id: string): Promise<Analysis | undefined>;
  analyze(workspaceId: string, input: AnalysisCreateInput): Promise<Analysis | undefined>;
  listExperiments(workspaceId: string): Promise<readonly Experiment[]>;
  getExperiment(workspaceId: string, id: string): Promise<Experiment | undefined>;
  createExperiment(workspaceId: string, input: ExperimentCreateInput): Promise<Experiment>;
  validateExperiment(workspaceId: string, id: string, requestId: string): Promise<Experiment | undefined>;
  listTrainingRuns(workspaceId: string, experimentId?: string): Promise<readonly TrainingRun[]>;
  getTrainingRun(workspaceId: string, id: string): Promise<TrainingRun | undefined>;
  startTraining(workspaceId: string, experimentId: string, input: TrainingStartInput): Promise<TrainingRun | undefined>;
  cancelTraining(workspaceId: string, id: string, input: TrainingCancelInput): Promise<TrainingRun | undefined>;
  listEvaluations(workspaceId: string, experimentId?: string): Promise<readonly Evaluation[]>;
  getEvaluation(workspaceId: string, id: string): Promise<Evaluation | undefined>;
  evaluate(workspaceId: string, input: EvaluationCreateInput): Promise<Evaluation | undefined>;
  compare(workspaceId: string, input: ExperimentCompareInput): Promise<ExperimentComparison | undefined>;
  listModels(workspaceId: string, modelName?: string): Promise<readonly ModelVersion[]>;
  getModel(workspaceId: string, id: string): Promise<ModelVersion | undefined>;
  registerModel(workspaceId: string, input: ModelRegisterInput): Promise<ModelVersion | undefined>;
  updateModelStage(workspaceId: string, id: string, input: ModelStageInput): Promise<ModelVersion | undefined>;
}

export interface GlobalPipelineFacade {
  list(workspaceId: string): Promise<readonly Pipeline[]>;
  get(workspaceId: string, id: string): Promise<Pipeline | undefined>;
  create(workspaceId: string, input: PipelineCreateInput): Promise<Pipeline>;
  listRuns(workspaceId: string, pipelineId?: string): Promise<readonly PipelineRun[]>;
  getRun(workspaceId: string, id: string): Promise<PipelineRun | undefined>;
  run(workspaceId: string, id: string, input: PipelineRunInput): Promise<PipelineRun | undefined>;
  cancelRun(workspaceId: string, id: string, input: PipelineCancelInput): Promise<PipelineRun | undefined>;
}

export interface GlobalServingFacade {
  listPackages(workspaceId: string): Promise<readonly ModelPackage[]>;
  getPackage(workspaceId: string, id: string): Promise<ModelPackage | undefined>;
  createPackage(workspaceId: string, input: ModelPackageCreateInput): Promise<ModelPackage | undefined>;
  listEndpoints(workspaceId: string): Promise<readonly ServingEndpoint[]>;
  getEndpoint(workspaceId: string, id: string): Promise<ServingEndpoint | undefined>;
  deploy(workspaceId: string, input: ServingEndpointCreateInput): Promise<ServingEndpoint | undefined>;
  action(workspaceId: string, id: string, action: 'pause' | 'resume' | 'archive' | 'rollback', input: ServingEndpointActionInput): Promise<ServingEndpoint | undefined>;
}

export interface GlobalPolicyFacade {
  list(workspaceId: string): Promise<readonly PolicyDecision[]>;
  get(workspaceId: string, id: string): Promise<PolicyDecision | undefined>;
  rules(workspaceId: string): Promise<readonly PolicyRule[]>;
  setRules(workspaceId: string, input: PolicyRulesUpdateInput): Promise<readonly PolicyRule[]>;
  evaluate(workspaceId: string, input: PolicyEvaluateInput): Promise<PolicyDecision>;
  approve(workspaceId: string, id: string, input: PolicyDecisionResolveInput): Promise<PolicyDecision | undefined>;
  deny(workspaceId: string, id: string, input: PolicyDecisionResolveInput): Promise<PolicyDecision | undefined>;
  audit(workspaceId: string, id: string, input: PolicyDecisionAuditInput): Promise<PolicyDecision | undefined>;
  explain(workspaceId: string, id: string): Promise<PolicyDecision | undefined>;
}

export interface GlobalResourceFacade {
  list(workspaceId: string, type?: ResourceType): Promise<readonly Resource[]>;
  get(workspaceId: string, id: string): Promise<Resource | undefined>;
  create(workspaceId: string, input: ResourceCreateInput): Promise<Resource>;
  update(workspaceId: string, id: string, input: ResourceUpdateInput): Promise<Resource | undefined>;
  execute(workspaceId: string, id: string, input: ResourceExecuteInput): Promise<ResourceExecution>;
  archive(workspaceId: string, id: string, input: ResourceUpdateInput): Promise<Resource | undefined>;
}

export interface GlobalArtifactFacade {
  list(workspaceId: string, kind?: ArtifactKind): Promise<readonly Artifact[]>;
  get(workspaceId: string, id: string): Promise<Artifact | undefined>;
  create(workspaceId: string, input: ArtifactCreateInput): Promise<Artifact>;
  download(workspaceId: string, id: string): Promise<ArtifactDownload | undefined>;
  downloadRange(
    workspaceId: string,
    id: string,
    input?: ArtifactDownloadRangeInput,
  ): Promise<ArtifactDownloadChunk | undefined>;
  lineage(workspaceId: string, id: string): Promise<ArtifactLineage | undefined>;
  expire(workspaceId: string, id: string, input: ArtifactExpireInput): Promise<Artifact | undefined>;
}

export interface GlobalExecutionTargetFacade {
  list(workspaceId: string): Promise<readonly ExecutionTarget[]>;
  get(workspaceId: string, id: string): Promise<ExecutionTarget | undefined>;
  register(workspaceId: string, input: ExecutionTargetCreateInput): Promise<ExecutionTarget>;
  update(workspaceId: string, id: string, input: ExecutionTargetUpdateInput): Promise<ExecutionTarget | undefined>;
  markReady(workspaceId: string, id: string, input: ExecutionTargetCommandInput): Promise<ExecutionTarget | undefined>;
  disable(workspaceId: string, id: string, input: ExecutionTargetCommandInput): Promise<ExecutionTarget | undefined>;
  acquireLease(workspaceId: string, id: string, input: ExecutionLeaseAcquireInput): Promise<ExecutionLease>;
  releaseLease(workspaceId: string, id: string, leaseId: string, input: ExecutionLeaseReleaseInput): Promise<ExecutionLease | undefined>;
}

export interface GlobalAutomationFacade {
  list(workspaceId: string): Promise<readonly Automation[]>;
  get(workspaceId: string, id: string): Promise<Automation | undefined>;
  history(workspaceId: string, id?: string): Promise<readonly AutomationFireResult[]>;
  create(workspaceId: string, input: AutomationCreateInput): Promise<Automation>;
  update(workspaceId: string, id: string, input: AutomationUpdateInput): Promise<Automation | undefined>;
  fire(workspaceId: string, id: string, input: AutomationFireInput): Promise<AutomationFireResult>;
}

export interface GlobalCommercialFacade {
  listMembers(workspaceId: string): Promise<readonly WorkspaceMember[]>;
  upsertMember(workspaceId: string, input: WorkspaceMemberUpsertInput): Promise<WorkspaceMember>;
  listEntitlements(workspaceId: string): Promise<readonly WorkspaceEntitlement[]>;
  setEntitlement(workspaceId: string, input: WorkspaceEntitlementUpdateInput): Promise<WorkspaceEntitlement>;
  recordUsage(workspaceId: string, input: UsageRecordCreateInput): Promise<UsageRecord>;
  usageSummary(workspaceId: string, query?: UsageSummaryQuery): Promise<UsageSummary>;
}

export interface GlobalUsageFacade {
  recordUsage(workspaceId: string, input: UsageRecordCreateInput): Promise<UsageRecord>;
  usageSummary(workspaceId: string, query?: UsageSummaryQuery): Promise<UsageSummary>;
}

export interface GlobalBudgetFacade {
  list(workspaceId: string): Promise<readonly Budget[]>;
  status(workspaceId: string): Promise<BudgetStatus>;
  configure(workspaceId: string, input: BudgetConfigureInput): Promise<Budget>;
  reserve(workspaceId: string, input: BudgetReserveInput): Promise<BudgetReservationResult>;
  release(workspaceId: string, input: BudgetReleaseInput): Promise<BudgetReservation>;
  reconcile(workspaceId: string, input: BudgetReconcileInput): Promise<BudgetReservation>;
}

export interface GlobalGovernanceFacade {
  listOrganizations(): Promise<readonly Organization[]>;
  getOrganization(id: string): Promise<Organization | undefined>;
  listOrganizationMembers(id: string): Promise<readonly OrganizationMember[]>;
  createOrganization(input: OrganizationCreateInput): Promise<Organization>;
  upsertOrganizationMember(input: OrganizationMemberUpsertInput): Promise<OrganizationMember>;
  listProjects(organizationId?: string): Promise<readonly Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  listProjectMembers(id: string): Promise<readonly ProjectMember[]>;
  createProject(input: ProjectCreateInput): Promise<Project>;
  upsertProjectMember(input: ProjectMemberUpsertInput): Promise<ProjectMember>;
  bindWorkspace(projectId: string, input: ProjectWorkspaceBindInput): Promise<Project>;
  projectForWorkspace(workspaceId: string): Promise<Project | undefined>;
  listProjectBindings(projectId: string, workspaceId?: string): Promise<readonly ProjectBinding[]>;
  bindProjectResource(input: ProjectBindingCreateInput): Promise<ProjectBinding>;
  removeProjectBinding(input: ProjectBindingRemoveInput): Promise<ProjectBinding>;
  ensureLocalOrganization(actorId?: string): Promise<Organization>;
}

export interface GlobalPlatformIdentityFacade {
  status(): Promise<PlatformIdentityStatus>;
  startPkce(): Promise<PlatformIdentityPkceStart>;
  completePkce(input: PlatformIdentityPkceCompleteInput): Promise<PlatformIdentityStatus>;
  startDevice(): Promise<PlatformIdentityDeviceStart>;
  pollDevice(input: PlatformIdentityDevicePollInput): Promise<PlatformIdentityDevicePollResult>;
  logout(): Promise<PlatformIdentityLogoutResult>;
}

export interface GlobalPlatformAuthorizationFacade {
  evaluate(input: PlatformAuthorizationEvaluateInput): Promise<PlatformAuthorizationDecision>;
}

export interface GlobalPlatformPluginsFacade {
  list(projectId?: string): Promise<readonly PlatformPlugin[]>;
  get(id: string): Promise<PlatformPlugin | undefined>;
  discover(input: PlatformPluginDiscoverInput): Promise<PlatformPluginManifest>;
  install(input: PlatformPluginInstallInput): Promise<PlatformPlugin>;
  configure(input: PlatformPluginConfigureInput): Promise<PlatformPlugin>;
  command(input: PlatformPluginCommandInput): Promise<PlatformPlugin>;
}

export interface GlobalPlatformEventsFacade {
  replay(workspaceId: string, afterSequence?: number, limit?: number): Promise<PlatformReplayPage>;
  /**
   * Subscribe to live workspace lifecycle events. Callers can use `replay`
   * for catch-up and reconcile sequence gaps before consuming live changes.
   */
  subscribe(
    workspaceId: string,
    listener: (event: PlatformLifecycleEvent) => void,
    options?: PlatformEventSubscriptionOptions,
  ): IDisposable;
}

export interface PlatformEventSubscriptionOptions {
  readonly eventTypes?: readonly string[];
  readonly entityTypes?: readonly PlatformEntityType[];
  readonly onError?: (error: Error) => void;
}

/** Grouped workspace-platform facade exposed as `klient.global.platform`. */
export interface GlobalPlatformFacade {
  /** Resolve a workspace catalog id for a native Kimi work directory. */
  readonly workspaceIdForRoot?: (root: string) => Promise<string | undefined>;
  readonly workspaces: GlobalWorkspacesFacade;
  readonly connections: GlobalProviderConnectionsFacade;
  readonly datasets: GlobalDatasetFacade;
  readonly ml: GlobalMlFacade;
  readonly pipelines: GlobalPipelineFacade;
  readonly serving: GlobalServingFacade;
  readonly policy: GlobalPolicyFacade;
  readonly resources: GlobalResourceFacade;
  readonly artifacts: GlobalArtifactFacade;
  readonly executionTargets: GlobalExecutionTargetFacade;
  readonly automations: GlobalAutomationFacade;
  readonly commercial: GlobalCommercialFacade;
  readonly usage: GlobalUsageFacade;
  readonly budgets: GlobalBudgetFacade;
  readonly governance: GlobalGovernanceFacade;
  readonly identity: GlobalPlatformIdentityFacade;
  readonly authorization: GlobalPlatformAuthorizationFacade;
  readonly plugins: GlobalPlatformPluginsFacade;
  readonly platformEvents: GlobalPlatformEventsFacade;
}

export interface GlobalPluginsFacade {
  list(): Promise<readonly PluginSummary[]>;
  info(id: string): Promise<PluginInfo>;
  install(source: string): Promise<PluginSummary>;
  setEnabled(input: { id: string; enabled: boolean }): Promise<void>;
  setMcpServerEnabled(input: { id: string; server: string; enabled: boolean }): Promise<void>;
  remove(id: string): Promise<void>;
  reload(): Promise<ReloadSummary>;
  checkUpdates(): Promise<readonly PluginUpdateStatus[]>;
  listCommands(): Promise<readonly PluginCommandDef[]>;
}

export interface GlobalHostFsFacade {
  browse(absPath?: string): Promise<FsBrowseResponse>;
  home(): Promise<FsHomeResponse>;
}

/** Aggregated host/environment snapshot (`bootstrapService` properties). */
export interface KlientEnvInfo {
  readonly platform: string;
  readonly arch: string;
  readonly cwd: string;
  readonly osHomeDir: string;
  readonly homeDir: string;
  readonly configPath: string;
  readonly clientVersion: string;
  readonly sessionsDir: string;
  readonly blobsDir: string;
  readonly storeDir: string;
  readonly cacheDir: string;
  readonly logsDir: string;
}

export interface GlobalFacade {
  readonly sessions: GlobalSessionsFacade;
  readonly workspaces: GlobalWorkspacesFacade;
  readonly config: GlobalConfigFacade;
  readonly kosong: GlobalKosongFacade;
  readonly auth: GlobalAuthFacade;
  readonly flags: GlobalFlagsFacade;
  readonly plugins: GlobalPluginsFacade;
  readonly capabilities: GlobalCapabilitiesFacade;
  readonly connections: GlobalProviderConnectionsFacade;
  readonly datasets: GlobalDatasetFacade;
  readonly ml: GlobalMlFacade;
  readonly pipelines: GlobalPipelineFacade;
  readonly serving: GlobalServingFacade;
  readonly policy: GlobalPolicyFacade;
  readonly resources: GlobalResourceFacade;
  readonly artifacts: GlobalArtifactFacade;
  readonly executionTargets: GlobalExecutionTargetFacade;
  readonly automations: GlobalAutomationFacade;
  readonly commercial: GlobalCommercialFacade;
  readonly usage: GlobalUsageFacade;
  readonly budgets: GlobalBudgetFacade;
  readonly governance: GlobalGovernanceFacade;
  readonly platformEvents: GlobalPlatformEventsFacade;
  readonly platform: GlobalPlatformFacade;
  readonly hostFs: GlobalHostFsFacade;
  env(): Promise<KlientEnvInfo>;
}

// ---------------------------------------------------------------------------
// Implementation — thin reshaping over `Caller`. Casts are safe by
// construction: the contract validates outputs, and type-parity assertions
// tie every contract schema to its engine type.
// ---------------------------------------------------------------------------

const ENV_SCALAR_PROPERTIES = [
  'platform',
  'arch',
  'cwd',
  'osHomeDir',
  'homeDir',
  'configPath',
  'sessionsDir',
  'blobsDir',
  'storeDir',
  'cacheDir',
  'logsDir',
] as const;

/** JSON transports cannot preserve trailing `undefined` array arguments. */
function trimTrailingUndefined(args: readonly unknown[]): unknown[] {
  let end = args.length;
  while (end > 0 && args[end - 1] === undefined) end -= 1;
  return args.slice(0, end);
}

export function createGlobalFacade(
  scoped: ScopedCaller,
  scopedStream: ScopedStreamCaller,
  scopedListen: ScopedListenCaller,
): GlobalFacade {
  const call: Caller = (service, method, args) => scoped({}, service, method, args);
  const streamCall = (service: string, method: string, args: unknown[]) =>
    scopedStream({}, service, method, args);
  // The bootstrap snapshot is frozen at process start, so the aggregated
  // env() result can never change — resolve it once and reuse the promise.
  let envPromise: Promise<KlientEnvInfo> | undefined;
  const env = (): Promise<KlientEnvInfo> => {
    envPromise ??= Promise.all([
      ...ENV_SCALAR_PROPERTIES.map((prop) => call('bootstrapService', prop, []) as Promise<string>),
      // The wire surface keeps `clientVersion` (a string); it is sourced from
      // the bootstrap clientIdentity, which replaced the flat scalar.
      call('bootstrapService', 'clientIdentity', []) as Promise<{ version: string }>,
    ]).then((values) => {
      const scalars = Object.fromEntries(
        ENV_SCALAR_PROPERTIES.map((prop, index) => [prop, values[index]]),
      );
      const identity = values[values.length - 1] as { version: string };
      return { ...scalars, clientVersion: identity.version } as unknown as KlientEnvInfo;
    });
    return envPromise;
  };

  const identity: GlobalPlatformIdentityFacade = {
    status: () =>
      call('platformIdentityService', 'status', []) as Promise<PlatformIdentityStatus>,
    startPkce: () =>
      call('platformIdentityService', 'startPkce', []) as Promise<PlatformIdentityPkceStart>,
    completePkce: (input: PlatformIdentityPkceCompleteInput) =>
      call('platformIdentityService', 'completePkce', [input]) as Promise<PlatformIdentityStatus>,
    startDevice: () =>
      call('platformIdentityService', 'startDevice', []) as Promise<PlatformIdentityDeviceStart>,
    pollDevice: (input: PlatformIdentityDevicePollInput) =>
      call('platformIdentityService', 'pollDevice', [input]) as Promise<PlatformIdentityDevicePollResult>,
    logout: () =>
      call('platformIdentityService', 'logout', []) as Promise<PlatformIdentityLogoutResult>,
  };

  const authorization: GlobalPlatformAuthorizationFacade = {
    evaluate: (input: PlatformAuthorizationEvaluateInput) =>
      call('platformAuthorizationService', 'evaluate', [input]) as Promise<PlatformAuthorizationDecision>,
  };

  const platformPlugins: GlobalPlatformPluginsFacade = {
    list: (projectId) =>
      call('platformPluginService', 'list', trimTrailingUndefined([projectId])) as Promise<readonly PlatformPlugin[]>,
    get: (id) => call('platformPluginService', 'get', [id]) as Promise<PlatformPlugin | undefined>,
    discover: (input) =>
      call('platformPluginService', 'discover', [input]) as Promise<PlatformPluginManifest>,
    install: (input) =>
      call('platformPluginService', 'install', [input]) as Promise<PlatformPlugin>,
    configure: (input) =>
      call('platformPluginService', 'configure', [input]) as Promise<PlatformPlugin>,
    command: (input) =>
      call('platformPluginService', 'command', [input]) as Promise<PlatformPlugin>,
  };

  const facade: Omit<GlobalFacade, 'platform'> = {
    sessions: {
      list: (query) =>
        call('sessionIndex', 'listRecent', [query]) as Promise<Page<SessionSummary>>,
      get: (id) => call('sessionIndex', 'get', [id]) as Promise<SessionSummary | undefined>,
      countActive: (workspaceIds) =>
        call('sessionIndex', 'count', [{ workspaceIds }]) as Promise<number>,
      create: async ({ workDir, additionalDirs, title, mcpServers }) => {
        // The workspace handler owns session creation: materialize (or reuse)
        // the handler for the root, then create under it.
        const handler = (await scoped({}, 'workspaceLifecycleService', 'handlerFor', [
          { root: workDir },
        ])) as { id: string };
        const handle = (await scoped({ workspaceId: handler.id }, 'sessionLifecycleService', 'create', [
          { workDir, additionalDirs, mcpServers },
        ])) as { id: string };
        const scope = { sessionId: handle.id };
        if (title !== undefined) {
          await scoped(scope, 'sessionMetadata', 'setTitle', [title]);
        }
        return scoped(scope, 'sessionMetadata', 'read', []) as Promise<SessionMeta>;
      },
    },

    workspaces: {
      list: () => call('workspaceService', 'list', []) as Promise<readonly Workspace[]>,
      get: (id) => call('workspaceService', 'get', [id]) as Promise<Workspace | undefined>,
      createOrTouch: ({ root, name }) =>
        call('workspaceService', 'createOrTouch', [root, name]) as Promise<Workspace>,
      update: ({ id, patch }) =>
        call('workspaceService', 'update', [id, patch]) as Promise<Workspace | undefined>,
      delete: (id) => call('workspaceService', 'delete', [id]) as Promise<void>,
    },

    config: {
      get: <T>(domain: string) => call('configService', 'get', [domain]) as Promise<T>,
      getAll: () => call('configService', 'getAll', []) as Promise<Record<string, unknown>>,
      inspect: <T>(domain: string) =>
        call('configService', 'inspect', [domain]) as Promise<ConfigInspectValue<T>>,
      set: ({ domain, patch, target }) =>
        call('configService', 'set', [domain, patch, target]) as Promise<void>,
      replace: ({ domain, value, target }) =>
        // `null` is the wire encoding of "clear this domain" — JSON
        // round-trips cannot carry `undefined` (see IConfigService.replace).
        call('configService', 'replace', [domain, value === undefined ? null : value, target]) as Promise<void>,
      replaceSections: ({ sections, target }) =>
        call('configService', 'replaceSections', [
          Object.fromEntries(
            Object.entries(sections).map(([domain, value]) => [
              domain,
              value === undefined ? null : value,
            ]),
          ),
          target,
        ]) as Promise<void>,
      reload: () => call('configService', 'reload', []) as Promise<void>,
      diagnostics: () =>
        call('configService', 'diagnostics', []) as Promise<readonly ConfigDiagnostic[]>,
    },

    kosong: {
      listProviders: () =>
        call('modelResolver', 'listProviders', []) as Promise<
          readonly ProviderCatalogItem[]
        >,
      getProvider: (id) =>
        call('modelResolver', 'getProvider', [id]) as Promise<ProviderCatalogItem>,
      addProvider: ((
        idOrConfig: string | AnonymousProviderInput,
        maybeConfig?: ProviderInput,
      ): Promise<void> => {
        if (typeof idOrConfig === 'string') {
          // Named provider — map ProviderInput to ProviderConfig wire shape.
          const config = maybeConfig!;
          const wire: ProviderConfig = {
            type: config.type,
            baseUrl: config.baseUrl,
            defaultModel: config.defaultModel,
            apiKey: config.auth.method === 'api-key' ? config.auth.apiKey : '',
          };
          return call('providerService', 'set', [idOrConfig, wire]) as Promise<void>;
        }
        // Anonymous provider — map AnonymousProviderInput to ModelRecord wire shape.
        const anon = idOrConfig;
        const capabilities = anon.capabilities
          ? Object.entries(anon.capabilities)
              .filter(([, v]) => v)
              .map(([k]) => k)
          : undefined;
        const wire: ModelRecord = {
          model: anon.model,
          protocol: anon.protocol as ModelRecord['protocol'],
          baseUrl: anon.baseUrl,
          apiKey: anon.auth.method === 'api-key' ? anon.auth.apiKey : '',
          displayName: anon.displayName,
          maxContextSize: anon.maxContextSize,
          capabilities,
        };
        return call('modelService', 'set', [anon.id, wire]) as Promise<void>;
      }) as GlobalKosongFacade['addProvider'],
      removeProvider: async (id) => {
        // Try provider registry first; fall back to model registry.
        const existing = await call('providerService', 'get', [id]);
        if (existing !== undefined) {
          return call('providerService', 'delete', [id]) as Promise<void>;
        }
        return call('modelService', 'delete', [id]) as Promise<void>;
      },
      refreshProviders: (opts) =>
        call('providerDiscovery', 'refreshProviderModels', [
          opts,
        ]) as Promise<RefreshProviderModelsResponse>,

      listModels: () =>
        call('modelResolver', 'listModels', []) as Promise<readonly ModelCatalogItem[]>,
      setDefaultModel: (id) =>
        call('modelResolver', 'setDefaultModel', [id]) as Promise<SetDefaultModelResponse>,

      generate: (modelId, input, params) =>
        streamCall('modelResolver', 'generate', [modelId, input, params]) as AsyncIterable<GenerateEvent>,
    },

    auth: {
      status: (provider) => call('oauthService', 'status', [provider]) as Promise<AuthStatus>,
      summarize: () => call('authSummaryService', 'summarize', []) as Promise<readonly AuthStatus[]>,
      ensureReady: (modelOverride) =>
        call('authSummaryService', 'ensureReady', [modelOverride]) as Promise<void>,
      startLogin: (provider) =>
        call('oauthService', 'startLogin', [provider]) as Promise<OAuthFlowStart>,
      flow: (provider) =>
        call('oauthService', 'getFlow', [provider]) as Promise<OAuthFlowSnapshot | undefined>,
      cancelLogin: (provider) =>
        call('oauthService', 'cancelLogin', [provider]) as Promise<OAuthLoginCancelResponse>,
      logout: (provider) =>
        call('oauthService', 'logout', [provider]) as Promise<OAuthLogoutResponse>,
      refreshProviderModels: () =>
        call('oauthService', 'refreshOAuthProviderModels', []) as Promise<RefreshProviderModelsResponse>,
    },

    flags: {
      list: () => call('flagService', 'explainAll', []) as Promise<readonly ExperimentalFeatureState[]>,
      enabled: (id) => call('flagService', 'enabled', [id]) as Promise<boolean>,
      enabledIds: () => call('flagService', 'enabledIds', []) as Promise<readonly string[]>,
      explain: (id) =>
        call('flagService', 'explain', [id]) as Promise<ExperimentalFeatureState | undefined>,
      snapshot: () => call('flagService', 'snapshot', []) as Promise<Record<string, boolean>>,
    },

    plugins: {
      list: () => call('pluginService', 'listPlugins', []) as Promise<readonly PluginSummary[]>,
      info: (id) => call('pluginService', 'getPluginInfo', [{ id }]) as Promise<PluginInfo>,
      install: (source) =>
        call('pluginService', 'installPlugin', [{ source }]) as Promise<PluginSummary>,
      setEnabled: (input) => call('pluginService', 'setPluginEnabled', [input]) as Promise<void>,
      setMcpServerEnabled: (input) =>
        call('pluginService', 'setPluginMcpServerEnabled', [input]) as Promise<void>,
      remove: (id) => call('pluginService', 'removePlugin', [{ id }]) as Promise<void>,
      reload: () => call('pluginService', 'reloadPlugins', []) as Promise<ReloadSummary>,
      checkUpdates: () =>
        call('pluginService', 'checkUpdates', []) as Promise<readonly PluginUpdateStatus[]>,
      listCommands: () =>
        call('pluginService', 'listPluginCommands', []) as Promise<readonly PluginCommandDef[]>,
    },

    capabilities: {
      list: () => call('capabilityService', 'listCapabilities', []) as Promise<readonly CapabilityStatus[]>,
      get: (id) => call('capabilityService', 'getCapability', [id]) as Promise<CapabilityStatus>,
      install: (id) =>
        call('capabilityService', 'installCapability', [id]) as Promise<CapabilityStatus>,
    },

    connections: {
      list: (workspaceId) =>
        scoped({ workspaceId }, 'providerConnectionService', 'list', []) as Promise<readonly ProviderConnection[]>,
      get: (workspaceId, id) =>
        scoped({ workspaceId }, 'providerConnectionService', 'get', [id]) as Promise<ProviderConnection | undefined>,
      create: (workspaceId, input) =>
        scoped({ workspaceId }, 'providerConnectionService', 'create', [input]) as Promise<ProviderConnection>,
      createWithSecret: (workspaceId, input) =>
        scoped({ workspaceId }, 'providerRuntimeService', 'createConnection', [input]) as Promise<ProviderConnection>,
      update: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'providerConnectionService', 'update', [id, input]) as Promise<ProviderConnection | undefined>,
      updateSecret: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'providerRuntimeService', 'updateConnectionSecret', [id, input]) as Promise<ProviderConnection | undefined>,
      validate: async (workspaceId, id, input) => {
        const validation = await scoped({ workspaceId }, 'providerRuntimeService', 'validate', [id]);
        if (!(validation as { ok: boolean }).ok) return undefined;
        return scoped({ workspaceId }, 'providerConnectionService', 'validate', [id, input]) as Promise<ProviderConnection | undefined>;
      },
      activate: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'providerConnectionService', 'activate', [id, input]) as Promise<ProviderConnection | undefined>,
      revoke: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'providerRuntimeService', 'revoke', [id, input]) as Promise<ProviderConnection | undefined>,
      discoverModels: (workspaceId, id) =>
        scoped({ workspaceId }, 'providerRuntimeService', 'discoverModels', [id]) as Promise<ProviderModelDiscovery | undefined>,
    },

    datasets: {
      list: (workspaceId) =>
        scoped({ workspaceId }, 'datasetService', 'list', []) as Promise<readonly Dataset[]>,
      get: (workspaceId, id) =>
        scoped({ workspaceId }, 'datasetService', 'get', [id]) as Promise<Dataset | undefined>,
      create: (workspaceId, input) =>
        scoped({ workspaceId }, 'datasetService', 'create', [input]) as Promise<Dataset>,
      createVersion: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'datasetService', 'createVersion', [id, input]) as Promise<Dataset | undefined>,
      profile: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'datasetService', 'profile', [id, input]) as Promise<DatasetProfile | undefined>,
      query: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'datasetService', 'query', [id, input]) as Promise<DatasetQueryResult | undefined>,
      transform: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'datasetService', 'transform', [id, input]) as Promise<Dataset | undefined>,
    },

    ml: {
      listAnalyses: (workspaceId) =>
        scoped({ workspaceId }, 'mlService', 'listAnalyses', []) as Promise<readonly Analysis[]>,
      getAnalysis: (workspaceId, id) =>
        scoped({ workspaceId }, 'mlService', 'getAnalysis', [id]) as Promise<Analysis | undefined>,
      analyze: (workspaceId, input) =>
        scoped({ workspaceId }, 'mlService', 'analyze', [input]) as Promise<Analysis | undefined>,
      listExperiments: (workspaceId) =>
        scoped({ workspaceId }, 'mlService', 'listExperiments', []) as Promise<readonly Experiment[]>,
      getExperiment: (workspaceId, id) =>
        scoped({ workspaceId }, 'mlService', 'getExperiment', [id]) as Promise<Experiment | undefined>,
      createExperiment: (workspaceId, input) =>
        scoped({ workspaceId }, 'mlService', 'createExperiment', [input]) as Promise<Experiment>,
      validateExperiment: (workspaceId, id, requestId) =>
        scoped({ workspaceId }, 'mlService', 'validateExperiment', [id, requestId]) as Promise<Experiment | undefined>,
      listTrainingRuns: (workspaceId, experimentId) =>
        scoped({ workspaceId }, 'mlService', 'listTrainingRuns', trimTrailingUndefined([experimentId])) as Promise<readonly TrainingRun[]>,
      getTrainingRun: (workspaceId, id) =>
        scoped({ workspaceId }, 'mlService', 'getTrainingRun', [id]) as Promise<TrainingRun | undefined>,
      startTraining: (workspaceId, experimentId, input) =>
        scoped({ workspaceId }, 'mlService', 'startTraining', [experimentId, input]) as Promise<TrainingRun | undefined>,
      cancelTraining: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'mlService', 'cancelTraining', [id, input]) as Promise<TrainingRun | undefined>,
      listEvaluations: (workspaceId, experimentId) =>
        scoped({ workspaceId }, 'mlService', 'listEvaluations', trimTrailingUndefined([experimentId])) as Promise<readonly Evaluation[]>,
      getEvaluation: (workspaceId, id) =>
        scoped({ workspaceId }, 'mlService', 'getEvaluation', [id]) as Promise<Evaluation | undefined>,
      evaluate: (workspaceId, input) =>
        scoped({ workspaceId }, 'mlService', 'evaluate', [input]) as Promise<Evaluation | undefined>,
      compare: (workspaceId, input) =>
        scoped({ workspaceId }, 'mlService', 'compare', [input]) as Promise<ExperimentComparison | undefined>,
      listModels: (workspaceId, modelName) =>
        scoped({ workspaceId }, 'mlService', 'listModels', trimTrailingUndefined([modelName])) as Promise<readonly ModelVersion[]>,
      getModel: (workspaceId, id) =>
        scoped({ workspaceId }, 'mlService', 'getModel', [id]) as Promise<ModelVersion | undefined>,
      registerModel: (workspaceId, input) =>
        scoped({ workspaceId }, 'mlService', 'registerModel', [input]) as Promise<ModelVersion | undefined>,
      updateModelStage: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'mlService', 'updateModelStage', [id, input]) as Promise<ModelVersion | undefined>,
    },

    pipelines: {
      list: (workspaceId) =>
        scoped({ workspaceId }, 'pipelineService', 'list', []) as Promise<readonly Pipeline[]>,
      get: (workspaceId, id) =>
        scoped({ workspaceId }, 'pipelineService', 'get', [id]) as Promise<Pipeline | undefined>,
      create: (workspaceId, input) =>
        scoped({ workspaceId }, 'pipelineService', 'create', [input]) as Promise<Pipeline>,
      listRuns: (workspaceId, pipelineId) =>
        scoped({ workspaceId }, 'pipelineService', 'listRuns', trimTrailingUndefined([pipelineId])) as Promise<readonly PipelineRun[]>,
      getRun: (workspaceId, id) =>
        scoped({ workspaceId }, 'pipelineService', 'getRun', [id]) as Promise<PipelineRun | undefined>,
      run: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'pipelineService', 'run', [id, input]) as Promise<PipelineRun | undefined>,
      cancelRun: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'pipelineService', 'cancelRun', [id, input]) as Promise<PipelineRun | undefined>,
    },

    serving: {
      listPackages: (workspaceId) =>
        scoped({ workspaceId }, 'servingService', 'listPackages', []) as Promise<readonly ModelPackage[]>,
      getPackage: (workspaceId, id) =>
        scoped({ workspaceId }, 'servingService', 'getPackage', [id]) as Promise<ModelPackage | undefined>,
      createPackage: (workspaceId, input) =>
        scoped({ workspaceId }, 'servingService', 'createPackage', [input]) as Promise<ModelPackage | undefined>,
      listEndpoints: (workspaceId) =>
        scoped({ workspaceId }, 'servingService', 'listEndpoints', []) as Promise<readonly ServingEndpoint[]>,
      getEndpoint: (workspaceId, id) =>
        scoped({ workspaceId }, 'servingService', 'getEndpoint', [id]) as Promise<ServingEndpoint | undefined>,
      deploy: (workspaceId, input) =>
        scoped({ workspaceId }, 'servingService', 'deploy', [input]) as Promise<ServingEndpoint | undefined>,
      action: (workspaceId, id, action, input) =>
        scoped({ workspaceId }, 'servingService', 'action', [id, action, input]) as Promise<ServingEndpoint | undefined>,
    },

    policy: {
      list: (workspaceId) =>
        scoped({ workspaceId }, 'policyService', 'list', []) as Promise<readonly PolicyDecision[]>,
      get: (workspaceId, id) =>
        scoped({ workspaceId }, 'policyService', 'get', [id]) as Promise<PolicyDecision | undefined>,
      rules: (workspaceId) =>
        scoped({ workspaceId }, 'policyService', 'rules', []) as Promise<readonly PolicyRule[]>,
      setRules: (workspaceId, input) =>
        scoped({ workspaceId }, 'policyService', 'setRules', [input]) as Promise<readonly PolicyRule[]>,
      evaluate: (workspaceId, input) =>
        scoped({ workspaceId }, 'policyService', 'evaluate', [input]) as Promise<PolicyDecision>,
      approve: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'policyService', 'approve', [id, input]) as Promise<PolicyDecision | undefined>,
      deny: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'policyService', 'deny', [id, input]) as Promise<PolicyDecision | undefined>,
      audit: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'policyService', 'audit', [id, input]) as Promise<PolicyDecision | undefined>,
      explain: (workspaceId, id) =>
        scoped({ workspaceId }, 'policyService', 'explain', [id]) as Promise<PolicyDecision | undefined>,
    },

    resources: {
      list: (workspaceId, type) =>
        scoped({ workspaceId }, 'resourceService', 'list', trimTrailingUndefined([type])) as Promise<readonly Resource[]>,
      get: (workspaceId, id) =>
        scoped({ workspaceId }, 'resourceService', 'get', [id]) as Promise<Resource | undefined>,
      create: (workspaceId, input) =>
        scoped({ workspaceId }, 'resourceService', 'create', [input]) as Promise<Resource>,
      update: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'resourceService', 'update', [id, input]) as Promise<Resource | undefined>,
      execute: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'resourceService', 'execute', [id, input]) as Promise<ResourceExecution>,
      archive: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'resourceService', 'archive', [id, input]) as Promise<Resource | undefined>,
    },

    artifacts: {
      list: (workspaceId, kind) =>
        scoped({ workspaceId }, 'artifactService', 'list', trimTrailingUndefined([kind])) as Promise<readonly Artifact[]>,
      get: (workspaceId, id) =>
        scoped({ workspaceId }, 'artifactService', 'get', [id]) as Promise<Artifact | undefined>,
      create: (workspaceId, input) =>
        scoped({ workspaceId }, 'artifactService', 'create', [input]) as Promise<Artifact>,
      download: (workspaceId, id) =>
        scoped({ workspaceId }, 'artifactService', 'download', [id]) as Promise<ArtifactDownload | undefined>,
      downloadRange: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'artifactService', 'downloadRange', trimTrailingUndefined([id, input])) as Promise<ArtifactDownloadChunk | undefined>,
      lineage: (workspaceId, id) =>
        scoped({ workspaceId }, 'artifactService', 'lineage', [id]) as Promise<ArtifactLineage | undefined>,
      expire: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'artifactService', 'expire', [id, input]) as Promise<Artifact | undefined>,
    },

    executionTargets: {
      list: (workspaceId) =>
        scoped({ workspaceId }, 'executionTargetService', 'list', []) as Promise<readonly ExecutionTarget[]>,
      get: (workspaceId, id) =>
        scoped({ workspaceId }, 'executionTargetService', 'get', [id]) as Promise<ExecutionTarget | undefined>,
      register: (workspaceId, input) =>
        scoped({ workspaceId }, 'executionTargetService', 'register', [input]) as Promise<ExecutionTarget>,
      update: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'executionTargetService', 'update', [id, input]) as Promise<ExecutionTarget | undefined>,
      markReady: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'executionTargetService', 'markReady', [id, input]) as Promise<ExecutionTarget | undefined>,
      disable: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'executionTargetService', 'disable', [id, input]) as Promise<ExecutionTarget | undefined>,
      acquireLease: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'executionTargetService', 'acquireLease', [id, input]) as Promise<ExecutionLease>,
      releaseLease: (workspaceId, id, leaseId, input) =>
        scoped({ workspaceId }, 'executionTargetService', 'releaseLease', [id, leaseId, input]) as Promise<ExecutionLease | undefined>,
    },

    automations: {
      list: (workspaceId) =>
        scoped({ workspaceId }, 'automationService', 'list', []) as Promise<readonly Automation[]>,
      get: (workspaceId, id) =>
        scoped({ workspaceId }, 'automationService', 'get', [id]) as Promise<Automation | undefined>,
      history: (workspaceId, id) =>
        scoped({ workspaceId }, 'automationService', 'history', trimTrailingUndefined([id])) as Promise<readonly AutomationFireResult[]>,
      create: (workspaceId, input) =>
        scoped({ workspaceId }, 'automationService', 'create', [input]) as Promise<Automation>,
      update: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'automationService', 'update', [id, input]) as Promise<Automation | undefined>,
      fire: (workspaceId, id, input) =>
        scoped({ workspaceId }, 'automationService', 'fire', [id, input]) as Promise<AutomationFireResult>,
    },

    commercial: {
      listMembers: (workspaceId) =>
        scoped({ workspaceId }, 'commercialService', 'listMembers', []) as Promise<readonly WorkspaceMember[]>,
      upsertMember: (workspaceId, input) =>
        scoped({ workspaceId }, 'commercialService', 'upsertMember', [input]) as Promise<WorkspaceMember>,
      listEntitlements: (workspaceId) =>
        scoped({ workspaceId }, 'commercialService', 'listEntitlements', []) as Promise<readonly WorkspaceEntitlement[]>,
      setEntitlement: (workspaceId, input) =>
        scoped({ workspaceId }, 'commercialService', 'setEntitlement', [input]) as Promise<WorkspaceEntitlement>,
      recordUsage: (workspaceId, input) =>
        // The commercial facade remains for compatibility; usage authority is
        // the workspace usage service used by canonical Runs.
        scoped({ workspaceId }, 'workspaceUsageService', 'recordUsage', [input]) as Promise<UsageRecord>,
      usageSummary: (workspaceId, query) =>
        scoped({ workspaceId }, 'workspaceUsageService', 'usageSummary', trimTrailingUndefined([query])) as Promise<UsageSummary>,
    },

    usage: {
      recordUsage: (workspaceId, input) =>
        scoped({ workspaceId }, 'workspaceUsageService', 'recordUsage', [input]) as Promise<UsageRecord>,
      usageSummary: (workspaceId, query) =>
        scoped({ workspaceId }, 'workspaceUsageService', 'usageSummary', trimTrailingUndefined([query])) as Promise<UsageSummary>,
    },

    budgets: {
      list: (workspaceId) =>
        scoped({ workspaceId }, 'workspaceBudgetService', 'list', []) as Promise<readonly Budget[]>,
      status: (workspaceId) =>
        scoped({ workspaceId }, 'workspaceBudgetService', 'status', []) as Promise<BudgetStatus>,
      configure: (workspaceId, input) =>
        scoped({ workspaceId }, 'workspaceBudgetService', 'configure', [input]) as Promise<Budget>,
      reserve: (workspaceId, input) =>
        scoped({ workspaceId }, 'workspaceBudgetService', 'reserve', [input]) as Promise<BudgetReservationResult>,
      release: (workspaceId, input) =>
        scoped({ workspaceId }, 'workspaceBudgetService', 'release', [input]) as Promise<BudgetReservation>,
      reconcile: (workspaceId, input) =>
        scoped({ workspaceId }, 'workspaceBudgetService', 'reconcile', [input]) as Promise<BudgetReservation>,
    },

    governance: {
      listOrganizations: () =>
        call('platformGovernanceService', 'listOrganizations', []) as Promise<readonly Organization[]>,
      getOrganization: (id) =>
        call('platformGovernanceService', 'getOrganization', [id]) as Promise<Organization | undefined>,
      listOrganizationMembers: (id) =>
        call('platformGovernanceService', 'listOrganizationMembers', [id]) as Promise<readonly OrganizationMember[]>,
      createOrganization: (input) =>
        call('platformGovernanceService', 'createOrganization', [input]) as Promise<Organization>,
      upsertOrganizationMember: (input) =>
        call('platformGovernanceService', 'upsertOrganizationMember', [input]) as Promise<OrganizationMember>,
      listProjects: (organizationId) =>
        call('platformGovernanceService', 'listProjects', trimTrailingUndefined([organizationId])) as Promise<readonly Project[]>,
      getProject: (id) =>
        call('platformGovernanceService', 'getProject', [id]) as Promise<Project | undefined>,
      listProjectMembers: (id) =>
        call('platformGovernanceService', 'listProjectMembers', [id]) as Promise<readonly ProjectMember[]>,
      createProject: (input) =>
        call('platformGovernanceService', 'createProject', [input]) as Promise<Project>,
      upsertProjectMember: (input) =>
        call('platformGovernanceService', 'upsertProjectMember', [input]) as Promise<ProjectMember>,
      bindWorkspace: (projectId, input) =>
        call('platformGovernanceService', 'bindWorkspace', [projectId, input]) as Promise<Project>,
      projectForWorkspace: (workspaceId) =>
        call('platformGovernanceService', 'projectForWorkspace', [workspaceId]) as Promise<Project | undefined>,
      listProjectBindings: (projectId, workspaceId) =>
        call('platformGovernanceService', 'listProjectBindings', trimTrailingUndefined([projectId, workspaceId])) as Promise<readonly ProjectBinding[]>,
      bindProjectResource: (input) =>
        call('platformGovernanceService', 'bindProjectResource', [input]) as Promise<ProjectBinding>,
      removeProjectBinding: (input) =>
        call('platformGovernanceService', 'removeProjectBinding', [input]) as Promise<ProjectBinding>,
      ensureLocalOrganization: (actorId) =>
        call('platformGovernanceService', 'ensureLocalOrganization', trimTrailingUndefined([actorId])) as Promise<Organization>,
    },

    platformEvents: {
      replay: (workspaceId, afterSequence, limit) => {
        const args = limit === undefined
          ? trimTrailingUndefined([afterSequence])
          : [afterSequence ?? 0, limit];
        return scoped({ workspaceId }, 'platformEvents', 'replay', args) as Promise<PlatformReplayPage>;
      },
      subscribe: (workspaceId, listener, options) => {
        const eventTypes = options?.eventTypes === undefined
          ? undefined
          : new Set(options.eventTypes);
        const entityTypes = options?.entityTypes === undefined
          ? undefined
          : new Set(options.entityTypes);
        const reportError = options?.onError;
        return scopedListen(
          { workspaceId },
          { kind: 'emitter', service: 'platformEvents', event: 'onDidChange' },
          (raw) => {
            const parsed = platformLifecycleEventSchema.safeParse(raw);
            if (!parsed.success) {
              reportError?.(new Error(`invalid platform event: ${parsed.error.message}`));
              return;
            }
            const event = parsed.data;
            // The transport already routes by workspace, but keep the
            // boundary defensive in case a host misbinds an emitter.
            if (event.workspace_id !== workspaceId) return;
            if (eventTypes !== undefined && !eventTypes.has(event.event_type)) return;
            if (entityTypes !== undefined && !entityTypes.has(event.entity_type)) return;
            try {
              listener(event);
            } catch (error) {
              reportError?.(error instanceof Error ? error : new Error(String(error)));
            }
          },
          reportError,
        );
      },
    },

    hostFs: {
      browse: (absPath) =>
        call('hostFolderBrowser', 'browse', [absPath]) as Promise<FsBrowseResponse>,
      home: () => call('hostFolderBrowser', 'home', []) as Promise<FsHomeResponse>,
    },

    env,
  };

  return {
    ...facade,
    platform: {
      workspaceIdForRoot: async (root) => {
        const normalized = root.trim();
        if (normalized.length === 0) return undefined;
        const workspaces = await facade.workspaces.list();
        return workspaces.find((workspace) => workspace.root === normalized)?.id;
      },
      workspaces: facade.workspaces,
      connections: facade.connections,
      datasets: facade.datasets,
      ml: facade.ml,
      pipelines: facade.pipelines,
      serving: facade.serving,
      policy: facade.policy,
      resources: facade.resources,
      artifacts: facade.artifacts,
      executionTargets: facade.executionTargets,
      automations: facade.automations,
      commercial: facade.commercial,
      usage: facade.usage,
      budgets: facade.budgets,
      governance: facade.governance,
      identity,
      authorization,
      plugins: platformPlugins,
      platformEvents: facade.platformEvents,
    },
  };
}
