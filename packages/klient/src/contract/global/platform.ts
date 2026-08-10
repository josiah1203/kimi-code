/**
 * PEP-03/04 workspace platform services. The schemas are imported from the
 * canonical protocol package; klient only describes positional service calls.
 */

import { z } from 'zod';

import {
  artifactCreateInputSchema,
  artifactDownloadChunkSchema,
  artifactDownloadSchema,
  artifactDownloadRangeInputSchema,
  artifactExpireInputSchema,
  artifactKindSchema,
  artifactLineageSchema,
  artifactSchema,
  budgetConfigureInputSchema,
  budgetReconcileInputSchema,
  budgetReleaseInputSchema,
  budgetReservationSchema,
  budgetReserveInputSchema,
  budgetSchema,
  budgetStatusSchema,
  organizationCreateInputSchema,
  organizationMemberSchema,
  organizationMemberUpsertInputSchema,
  organizationSchema,
  platformIdentityDevicePollInputSchema,
  platformIdentityDevicePollResultSchema,
  platformIdentityDeviceStartSchema,
  platformIdentityLogoutResultSchema,
  platformIdentityPkceCompleteInputSchema,
  platformIdentityPkceStartSchema,
  platformIdentityStatusSchema,
  platformAuthorizationDecisionSchema,
  platformAuthorizationEvaluateInputSchema,
  platformPluginCommandInputSchema,
  platformPluginConfigureInputSchema,
  platformPluginDiscoverInputSchema,
  platformPluginInstallInputSchema,
  platformPluginManifestSchema,
  platformPluginSchema,
  projectCreateInputSchema,
  projectBindingCreateInputSchema,
  projectBindingRemoveInputSchema,
  projectBindingSchema,
  projectMemberSchema,
  projectMemberUpsertInputSchema,
  projectSchema,
  projectWorkspaceBindInputSchema,
  automationCreateInputSchema,
  automationFireInputSchema,
  automationFireResultSchema,
  automationSchema,
  automationUpdateInputSchema,
  datasetCreateInputSchema,
  datasetProfileInputSchema,
  datasetProfileSchema,
  datasetQueryInputSchema,
  datasetQueryResultSchema,
  datasetSchema,
  datasetTransformInputSchema,
  datasetVersionCreateInputSchema,
  executionLeaseAcquireInputSchema,
  executionLeaseReleaseInputSchema,
  executionLeaseSchema,
  executionTargetCommandInputSchema,
  executionTargetCreateInputSchema,
  executionTargetSchema,
  executionTargetUpdateInputSchema,
  platformReplayPageSchema,
  policyDecisionAuditInputSchema,
  policyDecisionResolveInputSchema,
  policyDecisionSchema,
  policyEvaluateInputSchema,
  policyRuleSchema,
  policyRulesUpdateInputSchema,
  providerConnectionCommandInputSchema,
  providerConnectionCreateInputSchema,
  providerConnectionCreateWithSecretInputSchema,
  providerConnectionSchema,
  providerConnectionUpdateInputSchema,
  providerConnectionUpdateWithSecretInputSchema,
  providerModelDiscoverySchema,
  resourceCreateInputSchema,
  resourceExecuteInputSchema,
  resourceExecutionSchema,
  resourceSchema,
  resourceTypeSchema,
  resourceUpdateInputSchema,
  usageRecordCreateInputSchema,
  usageRecordSchema,
  usageSummaryQuerySchema,
  usageSummarySchema,
  workspaceEntitlementSchema,
  workspaceEntitlementUpdateInputSchema,
  workspaceMemberSchema,
  workspaceMemberUpsertInputSchema,
  evaluationCreateInputSchema,
  evaluationIdSchema,
  evaluationSchema,
  analysisCreateInputSchema,
  analysisIdSchema,
  analysisSchema,
  experimentCompareInputSchema,
  experimentCreateInputSchema,
  experimentIdSchema,
  experimentSchema,
  experimentComparisonSchema,
  modelRegisterInputSchema,
  modelStageInputSchema,
  modelVersionIdSchema,
  modelVersionSchema,
  trainingCancelInputSchema,
  trainingRunIdSchema,
  trainingRunSchema,
  trainingStartInputSchema,
  pipelineCancelInputSchema,
  pipelineCreateInputSchema,
  pipelineIdSchema,
  pipelineRunIdSchema,
  pipelineRunInputSchema,
  pipelineRunSchema,
  pipelineSchema,
  modelPackageCreateInputSchema,
  modelPackageIdSchema,
  modelPackageSchema,
  servingEndpointActionInputSchema,
  servingEndpointCreateInputSchema,
  servingEndpointIdSchema,
  servingEndpointSchema,
} from '@moonshot-ai/protocol';

import { maybe } from '../helpers.js';
import type { ServiceContract } from '../types.js';

const providerConnectionOutput = maybe(providerConnectionSchema);

export const providerConnectionsContract = {
  list: { input: z.tuple([]), output: z.array(providerConnectionSchema) },
  get: { input: z.tuple([z.string()]), output: providerConnectionOutput },
  create: { input: z.tuple([providerConnectionCreateInputSchema]), output: providerConnectionSchema },
  update: {
    input: z.tuple([z.string(), providerConnectionUpdateInputSchema]),
    output: providerConnectionOutput,
  },
  validate: {
    input: z.tuple([z.string(), providerConnectionCommandInputSchema]),
    output: providerConnectionOutput,
  },
  activate: {
    input: z.tuple([z.string(), providerConnectionCommandInputSchema]),
    output: providerConnectionOutput,
  },
  revoke: {
    input: z.tuple([z.string(), providerConnectionCommandInputSchema]),
    output: providerConnectionOutput,
  },
  discoverModels: {
    input: z.tuple([z.string()]),
    output: maybe(providerModelDiscoverySchema),
  },
} satisfies ServiceContract;

/** Runtime bridge calls keep model discovery on the real provider boundary. */
export const providerRuntimeContract = {
  createConnection: {
    input: z.tuple([providerConnectionCreateWithSecretInputSchema]),
    output: providerConnectionSchema,
  },
  updateConnectionSecret: {
    input: z.tuple([z.string(), providerConnectionUpdateWithSecretInputSchema]),
    output: maybe(providerConnectionSchema),
  },
  validate: {
    input: z.tuple([z.string(), z.string().optional()]),
    output: z.strictObject({
      connection_id: z.string(),
      model: z.string(),
      ok: z.boolean(),
      duration_ms: z.number().int().nonnegative(),
      text: z.string().optional(),
      usage: z.record(z.string(), z.unknown()).optional(),
      policy_decision_id: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  discoverModels: {
    input: z.tuple([z.string(), z.object({ force_remote: z.boolean().optional() }).optional()]),
    output: providerModelDiscoverySchema,
  },
  revoke: {
    input: z.tuple([z.string(), providerConnectionCommandInputSchema]),
    output: providerConnectionOutput,
  },
} satisfies ServiceContract;

export const datasetContract = {
  list: { input: z.tuple([]), output: z.array(datasetSchema) },
  get: { input: z.tuple([z.string()]), output: maybe(datasetSchema) },
  create: { input: z.tuple([datasetCreateInputSchema]), output: datasetSchema },
  createVersion: {
    input: z.tuple([z.string(), datasetVersionCreateInputSchema]),
    output: maybe(datasetSchema),
  },
  profile: {
    input: z.tuple([z.string(), datasetProfileInputSchema]),
    output: maybe(datasetProfileSchema),
  },
  query: {
    input: z.tuple([z.string(), datasetQueryInputSchema]),
    output: maybe(datasetQueryResultSchema),
  },
  transform: {
    input: z.tuple([z.string(), datasetTransformInputSchema]),
    output: maybe(datasetSchema),
  },
} satisfies ServiceContract;

export const mlContract = {
  listAnalyses: { input: z.tuple([]), output: z.array(analysisSchema) },
  getAnalysis: { input: z.tuple([analysisIdSchema]), output: maybe(analysisSchema) },
  analyze: { input: z.tuple([analysisCreateInputSchema]), output: maybe(analysisSchema) },
  listExperiments: { input: z.tuple([]), output: z.array(experimentSchema) },
  getExperiment: { input: z.tuple([experimentIdSchema]), output: maybe(experimentSchema) },
  createExperiment: { input: z.tuple([experimentCreateInputSchema]), output: experimentSchema },
  validateExperiment: {
    input: z.tuple([experimentIdSchema, z.string()]),
    output: maybe(experimentSchema),
  },
  listTrainingRuns: {
    input: z.tuple([experimentIdSchema.optional()]),
    output: z.array(trainingRunSchema),
  },
  getTrainingRun: { input: z.tuple([trainingRunIdSchema]), output: maybe(trainingRunSchema) },
  startTraining: {
    input: z.tuple([experimentIdSchema, trainingStartInputSchema]),
    output: maybe(trainingRunSchema),
  },
  cancelTraining: {
    input: z.tuple([trainingRunIdSchema, trainingCancelInputSchema]),
    output: maybe(trainingRunSchema),
  },
  listEvaluations: {
    input: z.tuple([experimentIdSchema.optional()]),
    output: z.array(evaluationSchema),
  },
  getEvaluation: { input: z.tuple([evaluationIdSchema]), output: maybe(evaluationSchema) },
  evaluate: { input: z.tuple([evaluationCreateInputSchema]), output: maybe(evaluationSchema) },
  compare: { input: z.tuple([experimentCompareInputSchema]), output: maybe(experimentComparisonSchema) },
  listModels: { input: z.tuple([z.string().optional()]), output: z.array(modelVersionSchema) },
  getModel: { input: z.tuple([modelVersionIdSchema]), output: maybe(modelVersionSchema) },
  registerModel: { input: z.tuple([modelRegisterInputSchema]), output: maybe(modelVersionSchema) },
  updateModelStage: {
    input: z.tuple([modelVersionIdSchema, modelStageInputSchema]),
    output: maybe(modelVersionSchema),
  },
} satisfies ServiceContract;

export const pipelineContract = {
  list: { input: z.tuple([]), output: z.array(pipelineSchema) },
  get: { input: z.tuple([pipelineIdSchema]), output: maybe(pipelineSchema) },
  create: { input: z.tuple([pipelineCreateInputSchema]), output: pipelineSchema },
  listRuns: { input: z.tuple([pipelineIdSchema.optional()]), output: z.array(pipelineRunSchema) },
  getRun: { input: z.tuple([pipelineRunIdSchema]), output: maybe(pipelineRunSchema) },
  run: { input: z.tuple([pipelineIdSchema, pipelineRunInputSchema]), output: maybe(pipelineRunSchema) },
  cancelRun: { input: z.tuple([pipelineRunIdSchema, pipelineCancelInputSchema]), output: maybe(pipelineRunSchema) },
} satisfies ServiceContract;

export const servingContract = {
  listPackages: { input: z.tuple([]), output: z.array(modelPackageSchema) },
  getPackage: { input: z.tuple([modelPackageIdSchema]), output: maybe(modelPackageSchema) },
  createPackage: { input: z.tuple([modelPackageCreateInputSchema]), output: maybe(modelPackageSchema) },
  listEndpoints: { input: z.tuple([]), output: z.array(servingEndpointSchema) },
  getEndpoint: { input: z.tuple([servingEndpointIdSchema]), output: maybe(servingEndpointSchema) },
  deploy: { input: z.tuple([servingEndpointCreateInputSchema]), output: maybe(servingEndpointSchema) },
  action: {
    input: z.tuple([servingEndpointIdSchema, z.enum(['pause', 'resume', 'archive', 'rollback']), servingEndpointActionInputSchema]),
    output: maybe(servingEndpointSchema),
  },
} satisfies ServiceContract;

export const policyContract = {
  list: { input: z.tuple([]), output: z.array(policyDecisionSchema) },
  get: { input: z.tuple([z.string()]), output: maybe(policyDecisionSchema) },
  rules: { input: z.tuple([]), output: z.array(policyRuleSchema) },
  setRules: {
    input: z.tuple([policyRulesUpdateInputSchema]),
    output: z.array(policyRuleSchema),
  },
  evaluate: { input: z.tuple([policyEvaluateInputSchema]), output: policyDecisionSchema },
  approve: {
    input: z.tuple([z.string(), policyDecisionResolveInputSchema]),
    output: maybe(policyDecisionSchema),
  },
  deny: {
    input: z.tuple([z.string(), policyDecisionResolveInputSchema]),
    output: maybe(policyDecisionSchema),
  },
  audit: {
    input: z.tuple([z.string(), policyDecisionAuditInputSchema]),
    output: maybe(policyDecisionSchema),
  },
  explain: { input: z.tuple([z.string()]), output: maybe(policyDecisionSchema) },
} satisfies ServiceContract;

export const resourceContract = {
  list: { input: z.tuple([resourceTypeSchema.optional()]), output: z.array(resourceSchema) },
  get: { input: z.tuple([z.string()]), output: maybe(resourceSchema) },
  create: { input: z.tuple([resourceCreateInputSchema]), output: resourceSchema },
  update: { input: z.tuple([z.string(), resourceUpdateInputSchema]), output: maybe(resourceSchema) },
  execute: { input: z.tuple([z.string(), resourceExecuteInputSchema]), output: resourceExecutionSchema },
  archive: { input: z.tuple([z.string(), resourceUpdateInputSchema]), output: maybe(resourceSchema) },
} satisfies ServiceContract;

export const artifactContract = {
  list: { input: z.tuple([artifactKindSchema.optional()]), output: z.array(artifactSchema) },
  get: { input: z.tuple([z.string()]), output: maybe(artifactSchema) },
  create: { input: z.tuple([artifactCreateInputSchema]), output: artifactSchema },
  download: { input: z.tuple([z.string()]), output: maybe(artifactDownloadSchema) },
  downloadRange: {
    input: z.tuple([z.string(), artifactDownloadRangeInputSchema.optional()]),
    output: maybe(artifactDownloadChunkSchema),
  },
  lineage: { input: z.tuple([z.string()]), output: maybe(artifactLineageSchema) },
  expire: { input: z.tuple([z.string(), artifactExpireInputSchema]), output: maybe(artifactSchema) },
} satisfies ServiceContract;

export const executionTargetContract = {
  list: { input: z.tuple([]), output: z.array(executionTargetSchema) },
  get: { input: z.tuple([z.string()]), output: maybe(executionTargetSchema) },
  register: { input: z.tuple([executionTargetCreateInputSchema]), output: executionTargetSchema },
  update: { input: z.tuple([z.string(), executionTargetUpdateInputSchema]), output: maybe(executionTargetSchema) },
  markReady: { input: z.tuple([z.string(), executionTargetCommandInputSchema]), output: maybe(executionTargetSchema) },
  disable: { input: z.tuple([z.string(), executionTargetCommandInputSchema]), output: maybe(executionTargetSchema) },
  acquireLease: { input: z.tuple([z.string(), executionLeaseAcquireInputSchema]), output: executionLeaseSchema },
  releaseLease: {
    input: z.tuple([z.string(), z.string(), executionLeaseReleaseInputSchema]),
    output: maybe(executionLeaseSchema),
  },
} satisfies ServiceContract;

export const automationContract = {
  list: { input: z.tuple([]), output: z.array(automationSchema) },
  get: { input: z.tuple([z.string()]), output: maybe(automationSchema) },
  history: { input: z.tuple([z.string().optional()]), output: z.array(automationFireResultSchema) },
  create: { input: z.tuple([automationCreateInputSchema]), output: automationSchema },
  update: { input: z.tuple([z.string(), automationUpdateInputSchema]), output: maybe(automationSchema) },
  fire: { input: z.tuple([z.string(), automationFireInputSchema]), output: automationFireResultSchema },
} satisfies ServiceContract;

export const commercialContract = {
  listMembers: { input: z.tuple([]), output: z.array(workspaceMemberSchema) },
  upsertMember: { input: z.tuple([workspaceMemberUpsertInputSchema]), output: workspaceMemberSchema },
  listEntitlements: { input: z.tuple([]), output: z.array(workspaceEntitlementSchema) },
  setEntitlement: {
    input: z.tuple([workspaceEntitlementUpdateInputSchema]),
    output: workspaceEntitlementSchema,
  },
  recordUsage: { input: z.tuple([usageRecordCreateInputSchema]), output: usageRecordSchema },
  usageSummary: { input: z.tuple([usageSummaryQuerySchema.optional()]), output: usageSummarySchema },
} satisfies ServiceContract;

/** Open Core usage authority; commercial keeps its admin projection for compatibility. */
export const usageContract = {
  recordUsage: { input: z.tuple([usageRecordCreateInputSchema]), output: usageRecordSchema },
  usageSummary: { input: z.tuple([usageSummaryQuerySchema.optional()]), output: usageSummarySchema },
} satisfies ServiceContract;

export const budgetContract = {
  list: { input: z.tuple([]), output: z.array(budgetSchema) },
  status: { input: z.tuple([]), output: budgetStatusSchema },
  configure: { input: z.tuple([budgetConfigureInputSchema]), output: budgetSchema },
  reserve: { input: z.tuple([budgetReserveInputSchema]), output: z.strictObject({
    reservation: budgetReservationSchema,
    status: z.enum(['reserved', 'approval_required', 'blocked', 'unbudgeted']),
    warnings: z.array(z.string()),
  }) },
  release: { input: z.tuple([budgetReleaseInputSchema]), output: budgetReservationSchema },
  reconcile: { input: z.tuple([budgetReconcileInputSchema]), output: budgetReservationSchema },
} satisfies ServiceContract;

export const governanceContract = {
  listOrganizations: { input: z.tuple([]), output: z.array(organizationSchema) },
  getOrganization: { input: z.tuple([z.string()]), output: maybe(organizationSchema) },
  listOrganizationMembers: { input: z.tuple([z.string()]), output: z.array(organizationMemberSchema) },
  createOrganization: { input: z.tuple([organizationCreateInputSchema]), output: organizationSchema },
  upsertOrganizationMember: {
    input: z.tuple([organizationMemberUpsertInputSchema]),
    output: organizationMemberSchema,
  },
  listProjects: { input: z.tuple([z.string().optional()]), output: z.array(projectSchema) },
  getProject: { input: z.tuple([z.string()]), output: maybe(projectSchema) },
  listProjectMembers: { input: z.tuple([z.string()]), output: z.array(projectMemberSchema) },
  createProject: { input: z.tuple([projectCreateInputSchema]), output: projectSchema },
  upsertProjectMember: {
    input: z.tuple([projectMemberUpsertInputSchema]),
    output: projectMemberSchema,
  },
  bindWorkspace: {
    input: z.tuple([z.string(), projectWorkspaceBindInputSchema]),
    output: projectSchema,
  },
  projectForWorkspace: { input: z.tuple([z.string()]), output: maybe(projectSchema) },
  listProjectBindings: {
    input: z.tuple([z.string(), z.string().optional()]),
    output: z.array(projectBindingSchema),
  },
  bindProjectResource: {
    input: z.tuple([projectBindingCreateInputSchema]),
    output: projectBindingSchema,
  },
  removeProjectBinding: {
    input: z.tuple([projectBindingRemoveInputSchema]),
    output: projectBindingSchema,
  },
  ensureLocalOrganization: {
    input: z.tuple([z.string().optional()]),
    output: organizationSchema,
  },
} satisfies ServiceContract;

export const platformIdentityContract = {
  status: { input: z.tuple([]), output: platformIdentityStatusSchema },
  startPkce: { input: z.tuple([]), output: platformIdentityPkceStartSchema },
  completePkce: {
    input: z.tuple([platformIdentityPkceCompleteInputSchema]),
    output: platformIdentityStatusSchema,
  },
  startDevice: { input: z.tuple([]), output: platformIdentityDeviceStartSchema },
  pollDevice: {
    input: z.tuple([platformIdentityDevicePollInputSchema]),
    output: platformIdentityDevicePollResultSchema,
  },
  logout: { input: z.tuple([]), output: platformIdentityLogoutResultSchema },
} satisfies ServiceContract;

export const platformAuthorizationContract = {
  evaluate: {
    input: z.tuple([platformAuthorizationEvaluateInputSchema]),
    output: platformAuthorizationDecisionSchema,
  },
} satisfies ServiceContract;

export const platformPluginsContract = {
  list: { input: z.tuple([z.string().optional()]), output: z.array(platformPluginSchema) },
  get: { input: z.tuple([z.string()]), output: maybe(platformPluginSchema) },
  discover: {
    input: z.tuple([platformPluginDiscoverInputSchema]),
    output: platformPluginManifestSchema,
  },
  install: {
    input: z.tuple([platformPluginInstallInputSchema]),
    output: platformPluginSchema,
  },
  configure: {
    input: z.tuple([platformPluginConfigureInputSchema]),
    output: platformPluginSchema,
  },
  command: {
    input: z.tuple([platformPluginCommandInputSchema]),
    output: platformPluginSchema,
  },
} satisfies ServiceContract;

export const platformEventsContract = {
  replay: { input: z.tuple([z.number().optional(), z.number().optional()]), output: platformReplayPageSchema },
} satisfies ServiceContract;
