/**
 * Error facade — aggregates every domain's error contribution into the unified
 * `ErrorCodes` const and re-exports the error primitives. Importing this
 * module registers every domain's codes.
 */

import { CoreErrors } from '#/_base/errors/codes';
import { AgentLifecycleErrors } from '#/session/agentLifecycle/errors';
import { AuthErrors } from '#/app/auth/errors';
import { TaskErrors } from '#/agent/task/errors';
import { ProtocolErrors } from '#/kosong/protocol/errors';
import { ConfigErrors } from '#/app/config/errors';
import { CronErrors } from '#/app/cron/errors';
import { DebugErrors } from '#/debug/errors';
import { FileErrors } from '#/app/file/fileService';
import { FsErrors } from '#/workspace/workspaceFs/internal/errors';
import { FullCompactionErrors } from '#/agent/fullCompaction/errors';
import { GoalErrors } from '#/agent/goal/errors';
import { LoopErrors } from '#/agent/loop/errors';
import { McpErrors } from '#/mcpCore/errors';
import { ModelCatalogErrors } from '#/kosong/model/errors';
import { OsFsErrors } from '#/os/interface/hostFsErrors';
import { OsProcessErrors } from '#/os/interface/hostProcess';
import { PluginErrors } from '#/app/plugin/errors';
import { ProfileErrors } from '#/agent/profile/errors';
import { PromptErrors } from '#/agent/prompt/errors';
import { ModelsDevImportErrors } from '#/app/kosongConfig/errors';
import { SessionExportErrors } from '#/app/sessionExport/errors';
import { SessionErrors } from '#/session/errors';
import { SkillErrors } from '#/app/skillCatalog/errors';
import { StorageErrors } from '#/persistence/interface/storage';
import { TerminalErrors } from '#/os/interface/terminalErrors';
import { UsageErrors } from '#/agent/usage/errors';
import { WebErrors } from '#/app/web/errors';
import { WireErrors } from '#/wire/errors';
import { WorkspaceErrors } from '#/app/workspace/errors';
import { ArtifactErrors } from '#/workspace/artifacts/errors';
import { AutomationErrors } from '#/workspace/automations/errors';
import { ExecutionTargetErrors } from '#/workspace/executionTargets/errors';
import { PolicyErrors } from '#/workspace/policy/errors';
import { PlatformEventErrors } from '#/workspace/platformEvents/errors';
import { ProviderConnectionErrors } from '#/workspace/providerConnections/errors';
import { ProviderRuntimeErrors } from '#/workspace/providerConnections/runtimeErrors';
import { ResourceErrors } from '#/workspace/resources/errors';
import { DatasetErrors } from '#/workspace/datasets/errors';
import { MlErrors } from '#/workspace/ml/errors';
import { PipelineErrors } from '#/workspace/pipelines/errors';
import { ExecutionErrors } from '#/workspace/execution/errors';
import { ServingErrors } from '#/workspace/serving/errors';
import { WorkspaceUsageErrors } from '#/workspace/usage/errors';
import { BudgetErrors } from '#/workspace/budgets/errors';
import { GovernanceErrors } from '#/app/governance/errors';
import { AuthorizationErrors } from '#/app/authorization/errors';
import { PlatformPluginErrors } from '#/app/platformPlugins/errors';

export * from '#/_base/errors/codes';
export * from '#/_base/errors/errorMessage';
export * from '#/_base/errors/errors';
export * from '#/_base/errors/serialize';
export * from '#/_base/errors/unexpectedError';
export { AgentLifecycleErrors } from '#/session/agentLifecycle/errors';
export { AuthErrors } from '#/app/auth/errors';
export { TaskErrors } from '#/agent/task/errors';
export { ProtocolErrors } from '#/kosong/protocol/errors';
export { ConfigErrors } from '#/app/config/errors';
export { CronErrors } from '#/app/cron/errors';
export { DebugErrors } from '#/debug/errors';
export { FileErrors } from '#/app/file/fileService';
export { FsErrors } from '#/workspace/workspaceFs/internal/errors';
export { FullCompactionErrors } from '#/agent/fullCompaction/errors';
export { GoalErrors } from '#/agent/goal/errors';
export { LoopErrors } from '#/agent/loop/errors';
export { McpErrors } from '#/mcpCore/errors';
export { ModelCatalogErrors } from '#/kosong/model/errors';
export { OsFsErrors } from '#/os/interface/hostFsErrors';
export { OsProcessErrors } from '#/os/interface/hostProcess';
export { PluginErrors } from '#/app/plugin/errors';
export { ProfileErrors } from '#/agent/profile/errors';
export { PromptErrors } from '#/agent/prompt/errors';
export { ModelsDevImportErrors } from '#/app/kosongConfig/errors';
export { SessionExportErrors } from '#/app/sessionExport/errors';
export { SessionErrors } from '#/session/errors';
export { SkillErrors } from '#/app/skillCatalog/errors';
export { StorageErrors } from '#/persistence/interface/storage';
export { TerminalErrors } from '#/os/interface/terminalErrors';
export { UsageErrors } from '#/agent/usage/errors';
export { WebErrors } from '#/app/web/errors';
export { WireErrors } from '#/wire/errors';
export { WorkspaceErrors } from '#/app/workspace/errors';
export { ArtifactErrors } from '#/workspace/artifacts/errors';
export { AutomationErrors } from '#/workspace/automations/errors';
export { ExecutionTargetErrors } from '#/workspace/executionTargets/errors';
export { PolicyErrors } from '#/workspace/policy/errors';
export { PlatformEventErrors } from '#/workspace/platformEvents/errors';
export { ProviderConnectionErrors } from '#/workspace/providerConnections/errors';
export { ProviderRuntimeErrors } from '#/workspace/providerConnections/runtimeErrors';
export { ResourceErrors } from '#/workspace/resources/errors';
export { DatasetErrors } from '#/workspace/datasets/errors';
export { MlErrors } from '#/workspace/ml/errors';
export { PipelineErrors } from '#/workspace/pipelines/errors';
export { ExecutionErrors } from '#/workspace/execution/errors';
export { ServingErrors } from '#/workspace/serving/errors';
export { WorkspaceUsageErrors } from '#/workspace/usage/errors';
export { BudgetErrors } from '#/workspace/budgets/errors';
export { GovernanceErrors } from '#/app/governance/errors';
export { AuthorizationErrors } from '#/app/authorization/errors';
export { PlatformPluginErrors } from '#/app/platformPlugins/errors';

export const ErrorCodes = {
  ...CoreErrors.codes,
  ...AgentLifecycleErrors.codes,
  ...AuthErrors.codes,
  ...TaskErrors.codes,
  ...ProtocolErrors.codes,
  ...ConfigErrors.codes,
  ...CronErrors.codes,
  ...DebugErrors.codes,
  ...FileErrors.codes,
  ...FsErrors.codes,
  ...FullCompactionErrors.codes,
  ...GoalErrors.codes,
  ...LoopErrors.codes,
  ...McpErrors.codes,
  ...ModelCatalogErrors.codes,
  ...OsFsErrors.codes,
  ...OsProcessErrors.codes,
  ...PluginErrors.codes,
  ...ProfileErrors.codes,
  ...PromptErrors.codes,
  ...ModelsDevImportErrors.codes,
  ...SessionExportErrors.codes,
  ...SessionErrors.codes,
  ...SkillErrors.codes,
  ...StorageErrors.codes,
  ...TerminalErrors.codes,
  ...UsageErrors.codes,
  ...WebErrors.codes,
  ...WireErrors.codes,
  ...WorkspaceErrors.codes,
  ...ArtifactErrors.codes,
  ...AutomationErrors.codes,
  ...ExecutionTargetErrors.codes,
  ...PolicyErrors.codes,
  ...PlatformEventErrors.codes,
  ...ProviderConnectionErrors.codes,
  ...ProviderRuntimeErrors.codes,
  ...ResourceErrors.codes,
  ...DatasetErrors.codes,
  ...MlErrors.codes,
  ...PipelineErrors.codes,
  ...ExecutionErrors.codes,
  ...ServingErrors.codes,
  ...WorkspaceUsageErrors.codes,
  ...BudgetErrors.codes,
  ...GovernanceErrors.codes,
  ...AuthorizationErrors.codes,
  ...PlatformPluginErrors.codes,
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
