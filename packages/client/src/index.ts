/**
 * `@spiderbyte/client` public surface — the transport-agnostic client facade
 * over the SpiderByte Agent Core engine. Create a client facade with one of the
 * transport entry points (`@spiderbyte/client/ipc` or `/memory`); exported
 * `Klient*` names are retained compatibility identifiers; everything
 * exported here behaves identically regardless of which one carried the
 * bytes.
 */

export type {
  EventSourceRef,
  IDisposable,
  KlientChannel,
  ScopeRef,
} from './core/channel.js';
export { RPCError } from './core/errors.js';
export { KlientValidationError, type ValidationPhase } from './core/validation.js';
export {
  BrowserPlatformClient,
  BrowserPlatformError,
  type BrowserFetch,
  type BrowserFetchInit,
  type BrowserFetchResponse,
  type BrowserPlatformClientOptions,
  type BrowserPlatformEventHandlers,
  type BrowserPlatformEventOptions,
  type BrowserPlatformEventSubscription,
  type BrowserPlatformWorkspace,
  type BrowserWebSocketFactory,
  type BrowserWebSocketLike,
} from './transports/browser.js';
export * from './contract/platform.js';
export {
  createKlientFromChannel,
  type AgentHandle,
  type Klient,
  type KlientOptions,
  type SessionHandle,
} from './core/klient.js';
export type { KlientEvents } from './core/events/hub.js';
export type { Caller, ScopedCaller, ScopedListenCaller, ScopedStreamCaller } from './core/facade/global.js';

export type {
  ConfigTargetLiteral,
  GlobalAuthFacade,
  GlobalConfigFacade,
  GlobalArtifactFacade,
  GlobalAutomationFacade,
  GlobalDatasetFacade,
  GlobalExecutionTargetFacade,
  GlobalFacade,
  GlobalFlagsFacade,
  GlobalGovernanceFacade,
  GlobalPlatformAuthorizationFacade,
  GlobalPlatformPluginsFacade,
  GlobalHostFsFacade,
  GlobalKosongFacade,
  GlobalMlFacade,
  GlobalPipelineFacade,
  GlobalPluginsFacade,
  GlobalPolicyFacade,
  GlobalPlatformFacade,
  GlobalPlatformEventsFacade,
  PlatformEventSubscriptionOptions,
  GlobalProviderConnectionsFacade,
  GlobalResourceFacade,
  GlobalSessionsFacade,
  GlobalWorkspacesFacade,
  KlientEnvInfo,
  ModelCatalogItem,
  ProviderCatalogItem,
  RefreshProviderModelsOptions,
  RefreshProviderModelsResponse,
  SetDefaultModelResponse,
} from './core/facade/global.js';

export type {
  AnonymousProviderInput,
  GenerateEvent,
  GenerateInput,
  GenerateParams,
  ProviderAuth,
  ProviderInput,
} from './core/facade/kosong-types.js';

export type {
  SessionApprovalsFacade,
  SessionFacade,
  SessionInteractionsFacade,
  SessionQuestionsFacade,
  SessionRunsFacade,
  SessionRestoreOptions,
  SessionSkillsFacade,
  SessionStatus,
} from './core/facade/session.js';
export type {
  AgentCommandInfo,
  AgentContextData,
  AgentFacade,
  AgentTaskInfo,
  McpServerEntry,
  PlanData,
  PromptLaunchResult,
  SetModelResult,
  ShellCommandResult,
  ThinkingLevel,
  UsageStatus,
} from './core/facade/agent.js';

export type {
  CatalogChangedPayload,
  KlientEventName,
  KlientEventPayloads,
  SessionArchivedPayload,
  SessionMetaUpdatedPayload,
} from './contract/global/events.js';
export type { SessionEventPayloads } from './contract/session/events.js';
export type { AgentEventPayloads } from './contract/agent/events.js';

// Wire types re-exported for consumer convenience (type-only; the engine is
// not pulled in at runtime for http consumers).
export type {
  SessionListQuery,
  SessionSummary,
} from '@spiderbyte/agent-core/app/sessionIndex/sessionIndex';
export type { Page } from '@spiderbyte/agent-core/persistence/interface/queryStore';
export type {
  Workspace,
  WorkspaceUpdate,
} from '@spiderbyte/agent-core/app/workspace/workspace';
export type {
  ConfigDiagnostic,
  ConfigInspectValue,
} from '@spiderbyte/agent-core/app/config/config';
export type { ProviderConfig } from '@spiderbyte/agent-core/kosong/provider/provider';
export type { AuthStatus } from '@spiderbyte/agent-core/app/auth/auth';
export type { ExperimentalFeatureState } from '@spiderbyte/agent-core/app/flag/flag';
export type {
  FsBrowseResponse,
  FsHomeResponse,
} from '@spiderbyte/agent-core/app/hostFolderBrowser/hostFolderBrowser';
export type {
  PluginCommandDef,
  PluginInfo,
  PluginSummary,
  PluginUpdateStatus,
  ReloadSummary,
} from '@spiderbyte/agent-core/app/plugin/types';
export type {
  AgentMeta,
  SessionMeta,
  SessionMetaPatch,
} from '@spiderbyte/agent-core/session/sessionMetadata/sessionMetadata';
export type {
  ApprovalRequest,
  ApprovalResponse,
} from '@spiderbyte/agent-core/session/approval/approval';
export type {
  QuestionRequest,
  QuestionResult,
} from '@spiderbyte/agent-core/session/question/question';
export type {
  Interaction,
  InteractionKind,
} from '@spiderbyte/agent-core/session/interaction/interaction';
export type { SkillSummary } from '@spiderbyte/agent-core/app/skillCatalog/types';
export type { ContentPart } from '@spiderbyte/agent-core/kosong/contract/message';
export type { PermissionMode } from '@spiderbyte/agent-core/agent/permissionPolicy/types';
