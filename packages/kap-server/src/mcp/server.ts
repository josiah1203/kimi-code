/**
 * Headless MCP adapter for the local SpiderByte server.
 *
 * This module is deliberately an adapter, not a second platform service. It
 * resolves the canonical App/Workspace/Session services and keeps all input,
 * policy, persistence, and secret handling in those services. Hosted identity,
 * billing, managed compute, and enterprise controls are represented by the
 * capability report but are not implemented here.
 */

import {
  closeSessionById,
  getLiveSessionById,
  IHostFileSystem,
  IPlatformGovernanceService,
  ISessionIndex,
  ISessionContext,
  ISessionLifecycleService,
  ISessionRunService,
  IWorkspaceArtifactService,
  IWorkspaceBudgetService,
  IWorkspaceDatasetService,
  IWorkspaceExecutionTargetService,
  IWorkspaceLifecycleService,
  IWorkspaceMlService,
  IWorkspacePlatformEventService,
  IWorkspacePolicyService,
  IWorkspaceProviderConnectionService,
  IWorkspaceService,
  IWorkspaceSessions,
  IWorkspaceUsageService,
  baselineWorkflowProjection,
  executeBaselineWorkflow,
  resumeSessionById,
  type ISessionScopeHandle,
  type IWorkspaceScopeHandle,
  type Scope,
} from '@spiderbyte/agent-core';
import {
  analysisCreateInputSchema,
  datasetCreateInputSchema,
  datasetProfileInputSchema,
  datasetQueryInputSchema,
  datasetTransformInputSchema,
  experimentCompareInputSchema,
  experimentCreateInputSchema,
  modelRegisterInputSchema,
  modelStageInputSchema,
  organizationCreateInputSchema,
  policyDecisionResolveInputSchema,
  policyEvaluateInputSchema,
  projectCreateInputSchema,
  runActionInputSchema,
  runCreateInputSchema,
  runTransitionInputSchema,
  trainingCancelInputSchema,
  trainingStartInputSchema,
  type ArtifactKind,
  type ExperimentMetricSpec,
  type PlatformCapability,
  type Run,
} from '@spiderbyte/protocol';
import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult, ServerContext } from '@modelcontextprotocol/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { isAbsolute, relative, resolve } from 'node:path';

import type { ServerLogger } from '../services/pinoLoggerService';
import {
  assertProjectAuthorization,
  assertWorkspaceAuthorization,
  isWorkspaceAuthorized,
  listAuthorizedOrganizations,
  listAuthorizedProjects,
  resolveLocalActorId,
} from '../services/platformAuthorization';

export const SPIDERBYTE_MCP_SERVER_NAME = 'spiderbyte';
export const SPIDERBYTE_MCP_PROTOCOL_VERSION = '2026-07-28';
export const SPIDERBYTE_MCP_MAX_RESULT_TEXT = 8_000;
export const SPIDERBYTE_MCP_MAX_ARTIFACT_BYTES = 64 * 1024;
export const SPIDERBYTE_MCP_DEFAULT_TIMEOUT_MS = 60_000;
export const SPIDERBYTE_MCP_MAX_CURATED_STRUCTURED_BYTES = 64 * 1024;
const SPIDERBYTE_MCP_MAX_CURATED_ITEMS = 100;
const CURATED_BASELINE_CLAIMS = new Map<string, Promise<unknown>>();

export const SPIDERBYTE_MCP_PROFILES = ['full', 'curated'] as const;
export type SpyderbyteMcpProfile = (typeof SPIDERBYTE_MCP_PROFILES)[number];

/**
 * The public Otis surface is deliberately semantic and small. The full
 * `spiderbyte_*` inventory remains available to local repository developers,
 * but it is not the plugin contract.
 */
export const SPIDERBYTE_MCP_CURATED_TOOLS = [
  'list_workspaces',
  'list_projects',
  'list_execution_targets',
  'create_run',
  'get_run',
  'cancel_run',
  'list_artifacts',
  'get_artifact',
  'profile_dataset',
  'run_sql_analysis',
  'train_baseline_model',
  'get_capabilities',
  'request_approval',
] as const;

export function resolveSpyderbyteMcpProfile(value: string | undefined): SpyderbyteMcpProfile {
  if (value === undefined || value === '') return 'full';
  if ((SPIDERBYTE_MCP_PROFILES as readonly string[]).includes(value)) return value as SpyderbyteMcpProfile;
  throw new Error(`Unsupported SpiderByte MCP profile: ${value}`);
}

const CURATED_TOOL_ALIASES: Readonly<Record<string, (typeof SPIDERBYTE_MCP_CURATED_TOOLS)[number]>> = {
  spiderbyte_list_workspaces: 'list_workspaces',
  spiderbyte_list_projects: 'list_projects',
  spiderbyte_list_execution_targets: 'list_execution_targets',
  spiderbyte_create_run: 'create_run',
  spiderbyte_get_run: 'get_run',
  spiderbyte_cancel_run: 'cancel_run',
  spiderbyte_list_artifacts: 'list_artifacts',
  spiderbyte_get_artifact: 'get_artifact',
  spiderbyte_profile_dataset: 'profile_dataset',
  spiderbyte_query_dataset: 'run_sql_analysis',
  spiderbyte_train_baseline_model: 'train_baseline_model',
  spiderbyte_capabilities: 'get_capabilities',
  spiderbyte_request_approval: 'request_approval',
};

const CURATED_TOOL_DESCRIPTIONS: Readonly<Partial<Record<(typeof SPIDERBYTE_MCP_CURATED_TOOLS)[number], string>>> = {
  list_workspaces: 'List local SpiderByte workspaces visible to this authenticated daemon; returns stable workspace IDs and bounded metadata.',
  list_projects: 'List local SpiderByte projects visible to this authenticated daemon; use returned stable project IDs for follow-up governance work.',
  list_execution_targets: 'List authorized local or customer-managed execution targets; managed SpiderByte-hosted compute is never implied.',
  create_run: 'Create an idempotent durable Run envelope in an existing session; this records intent but does not execute work by itself.',
  get_run: 'Inspect one durable Run by stable session and Run IDs, including lifecycle state, target, policy references, and bounded outputs.',
  cancel_run: 'Cancel one durable Run after inspecting it; explicit confirmed=true is required and the action is audited.',
  list_artifacts: 'List bounded metadata for artifacts in an authorized workspace; content and secrets are not returned.',
  get_artifact: 'Retrieve bounded metadata for one stable artifact ID; use the local artifact service for authorized content access.',
  profile_dataset: 'Profile a registered dataset version through the governed local dataset service and return its durable profile artifact reference.',
  run_sql_analysis: 'Run a bounded read-only SQL analysis over one registered CSV or JSONL dataset; arbitrary database access is not exposed.',
  train_baseline_model: 'Launch the canonical local baseline dataset-to-model workflow; it creates a durable Run and requires explicit confirmation before compute.',
  get_capabilities: 'Report which SpiderByte capabilities are implemented locally, credential-dependent, unavailable, or require hosted infrastructure.',
  request_approval: 'Evaluate a requested governed action and return allow, deny, or approval-required; policy remains authoritative on the daemon.',
};

const capabilityStatusSchema = z.enum([
  'implemented',
  'local-only',
  'hosted-required',
  'credential-required',
  'provider-unavailable',
  'enterprise-only',
  'disabled',
  'planned',
]);

const commonOutputSchema = {
  request_id: z.string(),
  status: z.enum(['ok', 'error']),
  capability_status: capabilityStatusSchema,
  workspace_id: z.string().optional(),
  data: z.unknown(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
};

const workspaceSchema = { workspace_id: z.string().min(1).optional() };
const idempotencySchema = { idempotency_key: z.string().min(1).max(256).optional() };
const metadataSchema = { metadata: z.record(z.string(), z.unknown()).optional() };
const confirmationSchema = { confirmed: z.boolean().default(false) };
const baselineMetricSchema = z.object({
  name: z.string().min(1).max(160),
  higher_is_better: z.boolean().optional(),
  required_minimum: z.number().finite().optional(),
  maximum_regression: z.number().finite().nonnegative().optional(),
}).strict();

export interface SpyderbyteMcpOptions {
  readonly core: Scope;
  readonly mode: 'local-http' | 'local-stdio';
  readonly profile?: SpyderbyteMcpProfile;
  readonly defaultWorkspaceId?: string;
  readonly actorId?: string;
  readonly clientName?: string;
  readonly logger?: ServerLogger;
}

interface WorkspaceContext {
  readonly id: string;
  readonly root: string;
  readonly handle: IWorkspaceScopeHandle;
}

interface ToolExtra {
  readonly requestId?: string | number;
  readonly signal?: AbortSignal;
}

interface OperationValue {
  readonly __mcp_operation_value: true;
  readonly data: unknown;
  readonly meta?: Record<string, unknown>;
  readonly capabilityStatus?: z.infer<typeof capabilityStatusSchema>;
}

interface McpToolErrorOptions {
  readonly code: string;
  readonly message: string;
}

class McpToolError extends Error {
  readonly code: string;

  constructor(options: McpToolErrorOptions) {
    super(options.message);
    this.name = 'McpToolError';
    this.code = options.code;
  }
}

/**
 * Create one MCP server instance. The modern HTTP entry creates one instance
 * per request; the modern stdio entry pins one instance to a connection. The
 * server is safe to use without a UI.
 */
export function createSpyderbyteMcpServer(options: SpyderbyteMcpOptions): McpServer {
  const { core } = options;
  const profile = options.profile ?? 'full';
  const server = new McpServer(
    {
      name: SPIDERBYTE_MCP_SERVER_NAME,
      version: SPIDERBYTE_MCP_PROTOCOL_VERSION,
    },
    {
      instructions:
        `SpiderByte local Open Core MCP server (MCP protocol ${SPIDERBYTE_MCP_PROTOCOL_VERSION}, profile ${profile}). Use workspace_id for every workspace-scoped operation. Hosted identity, billing, managed compute, and enterprise controls are unavailable in this server.`,
    },
  );

  const register = (
    name: string,
    config: {
      readonly title: string;
      readonly description: string;
      readonly inputSchema?: Record<string, z.ZodTypeAny>;
      readonly annotations: {
        readonly readOnlyHint: boolean;
        readonly openWorldHint: boolean;
        readonly destructiveHint: boolean;
        readonly idempotentHint?: boolean;
      };
    },
    handler: (args: Record<string, unknown>, extra: ToolExtra) => Promise<CallToolResult>,
  ): void => {
    const curatedName = profile === 'curated' ? CURATED_TOOL_ALIASES[name] : undefined;
    if (profile === 'curated' && curatedName === undefined) return;
    const exposedName = curatedName ?? name;
    const description = curatedName === undefined
      ? config.description
      : CURATED_TOOL_DESCRIPTIONS[curatedName] ?? config.description;
    // The helper keeps every tool on the same bounded result/error envelope;
    // the official SDK performs the actual JSON-schema validation. Translate
    // the v2 context into the small adapter context used by the tool bodies so
    // request correlation and cancellation remain consistent across HTTP and
    // stdio.
    server.registerTool(
      exposedName,
      { ...config, description, outputSchema: commonOutputSchema },
      async (args, context: ServerContext) => {
        const result = await handler(args, {
          requestId: context.mcpReq.id,
          signal: context.mcpReq.signal,
        });
        return profile === 'curated' ? boundCuratedResult(result) : result;
      },
    );
  };

  register(
    'spiderbyte_capabilities',
    {
      title: 'Inspect SpiderByte capabilities',
      description:
        'Use when you need to know which SpiderByte capabilities are implemented locally, require credentials, require hosted infrastructure, or are unavailable before choosing a workflow.',
      inputSchema: {},
      annotations: readOnlyAnnotations(),
    },
    (_args, extra) => invokeTool('spiderbyte_capabilities', extra, async () => capabilityReport(options)),
  );

  register(
    'spiderbyte_account_status',
    {
      title: 'Inspect account and connection status',
      description:
        'Use when you need to understand the current local identity, workspace scope, provider credential status, or why hosted account features are unavailable.',
      inputSchema: {},
      annotations: readOnlyAnnotations(),
    },
    (_args, extra) => invokeTool('spiderbyte_account_status', extra, async () => ({
      mode: options.mode.startsWith('local') ? 'local' : 'unknown',
      actor_id: resolveLocalActorId(options.actorId),
      authentication: options.mode === 'local-http' ? 'local-bearer' : 'local-process',
      hosted_identity: capability('hosted_identity', 'hosted-required', 'No hosted SpiderByte identity authority is included in Open Core.'),
      billing: capability('billing', 'hosted-required', 'Billing, invoices, and commercial entitlements are outside this checkout.'),
      provider_oauth: capability('provider_oauth', 'provider-unavailable', 'Provider-specific OAuth adapters are not implemented in Open Core.'),
      managed_compute: capability('managed_compute', 'hosted-required', 'Managed GPU/CPU execution requires the commercial hosted control plane.'),
    })),
  );

  register(
    'spiderbyte_list_workspaces',
    {
      title: 'List local workspaces',
      description:
        'Use when you need to discover the registered local workspaces available to the current SpiderByte process.',
      inputSchema: {},
      annotations: readOnlyAnnotations(),
    },
    (_args, extra) => invokeTool('spiderbyte_list_workspaces', extra, async () => {
      const workspaces = await core.accessor.get(IWorkspaceService).list();
      const sessions = core.accessor.get(IWorkspaceSessions);
      const visible: Array<(typeof workspaces)[number]> = [];
      for (const workspace of workspaces) {
        if (await isWorkspaceAuthorized(core, {
          workspaceId: workspace.id,
          requestId: `mcp_list_workspaces:${workspace.id}`,
          capability: 'workspace.read',
          actorId: options.actorId,
        })) visible.push(workspace);
      }
      return Promise.all(
        visible.slice(0, profile === 'curated' ? SPIDERBYTE_MCP_MAX_CURATED_ITEMS : undefined).map(async (workspace) => ({
          ...workspace,
          session_count: await sessions.count(workspace.id),
          mode: 'local',
        })),
      );
    }),
  );

  register(
    'spiderbyte_get_workspace',
    {
      title: 'Inspect a local workspace',
      description:
        'Use when you need the registered root, identity, session count, and local mode status for one workspace.',
      inputSchema: { workspace_id: z.string().min(1) },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => invokeTool('spiderbyte_get_workspace', extra, async () => {
      const workspaceId = requireString(args, 'workspace_id');
      const workspace = await core.accessor.get(IWorkspaceService).get(workspaceId);
      if (workspace === undefined) throw notFound('workspace', workspaceId);
      await assertWorkspaceAuthorization(core, {
        workspaceId,
        requestId: requestIdFor(args, 'get_workspace', extra.requestId),
        capability: 'workspace.read',
        actorId: options.actorId,
      });
      return {
        ...workspace,
        session_count: await core.accessor.get(IWorkspaceSessions).count(workspace.id),
        mode: 'local',
      };
    }),
  );

  register(
    'spiderbyte_register_workspace',
    {
      title: 'Register a local workspace',
      description:
        'Use when you need to add an existing local directory to SpiderByte before creating sessions, datasets, or projects.',
      inputSchema: {
        root: z.string().min(1),
        name: z.string().min(1).max(100).optional(),
        ...idempotencySchema,
        ...confirmationSchema,
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    (args, extra) => invokeTool('spiderbyte_register_workspace', extra, async () => {
      requireConfirmation(args);
      const root = requireString(args, 'root');
      if (!isAbsolute(root)) throw invalid('root must be an absolute path');
      const stat = await core.accessor.get(IHostFileSystem).stat(root).catch(() => undefined);
      if (stat?.isDirectory !== true) throw invalid('root must be an existing directory');
      const name = optionalString(args, 'name');
      const workspace = await core.accessor.get(IWorkspaceService).createOrTouch(root, name);
      await assertWorkspaceAuthorization(core, {
        workspaceId: workspace.id,
        requestId: requestIdFor(args, 'register_workspace', extra.requestId),
        capability: 'project.manage',
        actorId: options.actorId,
      });
      return {
        ...workspace,
        session_count: await core.accessor.get(IWorkspaceSessions).count(workspace.id),
        mode: 'local',
      };
    }),
  );

  register(
    'spiderbyte_list_sessions',
    {
      title: 'List workspace sessions',
      description:
        'Use when you need to find recent SpiderByte sessions associated with a local workspace before inspecting or continuing a run.',
      inputSchema: { ...workspaceSchema, limit: z.number().int().min(1).max(20).default(20) },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_list_sessions', args, extra, options, async (workspace) => {
      const sessions = await core.accessor.get(IWorkspaceSessions).listRecent(workspace.id);
      return sessions.slice(0, optionalNumber(args, 'limit') ?? 20);
    }),
  );

  register(
    'spiderbyte_create_session',
    {
      title: 'Create a local session',
      description:
        'Use when you need a durable local session in a selected workspace as the execution envelope for a governed plan or run.',
      inputSchema: {
        ...workspaceSchema,
        cwd: z.string().min(1).optional(),
        session_id: z.string().min(1).max(256).optional(),
        ...idempotencySchema,
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    (args, extra) => withWorkspaceTool('spiderbyte_create_session', args, extra, options, async (workspace) => {
      const cwd = resolveWorkspacePath(workspace.root, optionalString(args, 'cwd'));
      const sessionId = optionalString(args, 'session_id');
      const handle = await workspace.handle.accessor.get(ISessionLifecycleService).create({
        workDir: cwd,
        sessionId,
      });
      return {
        session_id: handle.accessor.get(ISessionContext).sessionId,
        workspace_id: workspace.id,
        cwd,
        status: 'created',
      };
    }),
  );

  register(
    'spiderbyte_close_session',
    {
      title: 'Close a local session',
      description:
        'Use when you need to release a live local session after its work is complete; persisted session data is retained.',
      inputSchema: {
        ...workspaceSchema,
        session_id: z.string().min(1),
        ...confirmationSchema,
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    (args, extra) => withWorkspaceTool('spiderbyte_close_session', args, extra, options, async (workspace) => {
      requireConfirmation(args);
      const sessionId = requireString(args, 'session_id');
      await assertSessionWorkspace(core, workspace.id, sessionId);
      await closeSessionById(core.accessor, sessionId);
      return { session_id: sessionId, workspace_id: workspace.id, status: 'closed' };
    }),
  );

  register(
    'spiderbyte_list_organizations',
    {
      title: 'List local organizations',
      description:
        'Use when you need to inspect the local accountless organization records used to group projects and permissions.',
      inputSchema: {},
      annotations: readOnlyAnnotations(),
    },
    (_args, extra) => invokeTool('spiderbyte_list_organizations', extra, async () =>
      redact(await listAuthorizedOrganizations(core, options.actorId))),
  );

  register(
    'spiderbyte_create_organization',
    {
      title: 'Create a local organization',
      description:
        'Use when you need a local accountless organization to own projects and governance records.',
      inputSchema: { name: z.string().min(1).max(200), ...metadataSchema, ...idempotencySchema, ...confirmationSchema },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    (args, extra) => invokeTool('spiderbyte_create_organization', extra, async () => {
      requireConfirmation(args);
      const requestId = requestIdFor(args, 'organization');
      const organization = await core.accessor.get(IPlatformGovernanceService).createOrganization(
        organizationCreateInputSchema.parse({
          request_id: requestId,
          actor_id: resolveLocalActorId(options.actorId),
          name: requireString(args, 'name'),
          mode: 'local',
          metadata: optionalObject(args, 'metadata'),
        }),
      );
      return redact(organization);
    }),
  );

  register(
    'spiderbyte_list_projects',
    {
      title: 'List local projects',
      description:
        'Use when you need to inspect project records and their workspace bindings in the local governance store.',
      inputSchema: { organization_id: z.string().min(1).optional() },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => invokeTool('spiderbyte_list_projects', extra, async () => {
      const projects = await listAuthorizedProjects(core, optionalString(args, 'organization_id'), options.actorId);
      return redact(projects.slice(0, profile === 'curated' ? SPIDERBYTE_MCP_MAX_CURATED_ITEMS : undefined));
    }),
  );

  register(
    'spiderbyte_get_project',
    {
      title: 'Inspect a local project',
      description:
        'Use when you need a project definition, members, workspace bindings, and local role information.',
      inputSchema: { project_id: z.string().min(1) },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => invokeTool('spiderbyte_get_project', extra, async () => {
      const projectId = requireString(args, 'project_id');
      const governance = core.accessor.get(IPlatformGovernanceService);
      const project = await assertProjectAuthorization(core, {
        projectId,
        requestId: requestIdFor(args, 'get_project', extra.requestId),
        capability: 'project.read',
        actorId: options.actorId,
      });
      if (project === undefined) throw notFound('project', projectId);
      return redact({
        project,
        members: await governance.listProjectMembers(projectId),
        bindings: await governance.listProjectBindings(projectId),
      });
    }),
  );

  register(
    'spiderbyte_create_project',
    {
      title: 'Create a local project',
      description:
        'Use when you need a project to group one or more local workspaces and attach governance bindings.',
      inputSchema: {
        organization_id: z.string().min(1),
        name: z.string().min(1).max(200),
        ...metadataSchema,
        ...idempotencySchema,
        ...confirmationSchema,
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    (args, extra) => invokeTool('spiderbyte_create_project', extra, async () => {
      requireConfirmation(args);
      return redact(await core.accessor.get(IPlatformGovernanceService).createProject(
        projectCreateInputSchema.parse({
          request_id: requestIdFor(args, 'project'),
          actor_id: resolveLocalActorId(options.actorId),
          organization_id: requireString(args, 'organization_id'),
          name: requireString(args, 'name'),
          metadata: optionalObject(args, 'metadata'),
        }),
      ));
    }),
  );

  register(
    'spiderbyte_project_permissions',
    {
      title: 'Inspect project permissions',
      description:
        'Use when you need to inspect local project members, roles, and workspace bindings before a governed action.',
      inputSchema: { project_id: z.string().min(1) },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => invokeTool('spiderbyte_project_permissions', extra, async () => {
      const projectId = requireString(args, 'project_id');
      await assertProjectAuthorization(core, {
        projectId,
        requestId: requestIdFor(args, 'project_permissions', extra.requestId),
        capability: 'project.read',
        actorId: options.actorId,
      });
      const governance = core.accessor.get(IPlatformGovernanceService);
      const actor = resolveLocalActorId(options.actorId);
      return redact({
        project_id: projectId,
        members: await governance.listProjectMembers(projectId),
        bindings: await governance.listProjectBindings(projectId),
        actor_id: actor,
        actor_roles: await governance.resolveProjectRoles(projectId, actor),
      });
    }),
  );

  register(
    'spiderbyte_list_datasets',
    {
      title: 'List workspace datasets',
      description:
        'Use when you need to discover dataset versions and metadata available in a local workspace before profiling or modeling.',
      inputSchema: { ...workspaceSchema },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_list_datasets', args, extra, options, async (workspace) =>
      redact(await workspace.handle.accessor.get(IWorkspaceDatasetService).list())),
  );

  register(
    'spiderbyte_get_dataset',
    {
      title: 'Inspect a workspace dataset',
      description:
        'Use when you need dataset schema, versions, source metadata, or the current artifact reference.',
      inputSchema: { ...workspaceSchema, dataset_id: z.string().min(1) },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_get_dataset', args, extra, options, async (workspace) => {
      const datasetId = requireString(args, 'dataset_id');
      const dataset = await workspace.handle.accessor.get(IWorkspaceDatasetService).get(datasetId);
      if (dataset === undefined) throw notFound('dataset', datasetId);
      return redact(dataset);
    }),
  );

  register(
    'spiderbyte_register_dataset',
    {
      title: 'Register a local dataset',
      description:
        'Use when you need to register bounded CSV or JSONL content or a workspace-local source file as an immutable dataset version.',
      inputSchema: {
        ...workspaceSchema,
        name: z.string().min(1).max(500),
        format: z.enum(['csv', 'jsonl']).default('csv'),
        source_path: z.string().min(1).optional(),
        content_base64: z.string().max(14_000_000).optional(),
        run_id: z.string().min(1).optional(),
        policy_decision_id: z.string().min(1).optional(),
        ...metadataSchema,
        ...idempotencySchema,
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (args, extra) => withWorkspaceTool('spiderbyte_register_dataset', args, extra, options, async (workspace) => {
      const sourcePath = optionalString(args, 'source_path');
      if (sourcePath !== undefined) resolveWorkspacePath(workspace.root, sourcePath);
      const dataset = await workspace.handle.accessor.get(IWorkspaceDatasetService).create(
        datasetCreateInputSchema.parse({
          request_id: requestIdFor(args, 'dataset'),
          name: requireString(args, 'name'),
          format: optionalString(args, 'format') ?? 'csv',
          source_path: sourcePath,
          content_base64: optionalString(args, 'content_base64'),
          run_id: optionalString(args, 'run_id'),
          policy_decision_id: optionalString(args, 'policy_decision_id'),
          metadata: optionalObject(args, 'metadata'),
        }),
      );
      return redact(dataset);
    }),
  );

  register(
    'spiderbyte_profile_dataset',
    {
      title: 'Profile a dataset',
      description:
        'Use when you need column types, nullability, distinct counts, and a durable profile artifact for a local dataset.',
      inputSchema: {
        ...workspaceSchema,
        dataset_id: z.string().min(1),
        version: z.number().int().positive().optional(),
        run_id: z.string().min(1).optional(),
        policy_decision_id: z.string().min(1).optional(),
        ...idempotencySchema,
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (args, extra) => withWorkspaceTool(
      'spiderbyte_profile_dataset',
      args,
      extra,
      options,
      async (workspace) => redact(await workspace.handle.accessor.get(IWorkspaceDatasetService).profile(
        requireString(args, 'dataset_id'),
        datasetProfileInputSchema.parse({
          request_id: requestIdFor(args, 'dataset_profile'),
          run_id: optionalString(args, 'run_id'),
          version: optionalNumber(args, 'version'),
          policy_decision_id: optionalString(args, 'policy_decision_id'),
        }),
      )),
    ),
  );

  register(
    'spiderbyte_query_dataset',
    {
      title: 'Query a dataset',
      description:
        'Use when you need a bounded read-only SQL preview over a registered CSV or JSONL dataset; the query runs through SpiderByte’s isolated dataset service.',
      inputSchema: {
        ...workspaceSchema,
        dataset_id: z.string().min(1),
        sql: z.string().min(1).max(50_000),
        version: z.number().int().positive().optional(),
        max_rows: z.number().int().positive().max(1_000).default(1_000),
        run_id: z.string().min(1).optional(),
        policy_decision_id: z.string().min(1).optional(),
        ...idempotencySchema,
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (args, extra) => withWorkspaceTool(
      'spiderbyte_query_dataset',
      args,
      extra,
      options,
      async (workspace) => redact(await workspace.handle.accessor.get(IWorkspaceDatasetService).query(
        requireString(args, 'dataset_id'),
        datasetQueryInputSchema.parse({
          request_id: requestIdFor(args, 'dataset_query'),
          sql: requireString(args, 'sql'),
          version: optionalNumber(args, 'version'),
          max_rows: optionalNumber(args, 'max_rows') ?? 1_000,
          run_id: optionalString(args, 'run_id'),
          policy_decision_id: optionalString(args, 'policy_decision_id'),
        }),
      )),
    ),
  );

  register(
    'spiderbyte_transform_dataset',
    {
      title: 'Create a transformed dataset version',
      description:
        'Use when you need to persist a new dataset version from a bounded SQL transformation; confirm this action because it writes a new artifact and version.',
      inputSchema: {
        ...workspaceSchema,
        dataset_id: z.string().min(1),
        sql: z.string().min(1).max(50_000),
        version: z.number().int().positive().optional(),
        max_rows: z.number().int().positive().max(500_000).default(500_000),
        run_id: z.string().min(1).optional(),
        policy_decision_id: z.string().min(1).optional(),
        ...metadataSchema,
        ...idempotencySchema,
        ...confirmationSchema,
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (args, extra) => withWorkspaceTool('spiderbyte_transform_dataset', args, extra, options, async (workspace) => {
      requireConfirmation(args);
      return redact(await workspace.handle.accessor.get(IWorkspaceDatasetService).transform(
        requireString(args, 'dataset_id'),
        datasetTransformInputSchema.parse({
          request_id: requestIdFor(args, 'dataset_transform'),
          sql: requireString(args, 'sql'),
          version: optionalNumber(args, 'version'),
          max_rows: optionalNumber(args, 'max_rows') ?? 500_000,
          run_id: optionalString(args, 'run_id'),
          policy_decision_id: optionalString(args, 'policy_decision_id'),
          metadata: optionalObject(args, 'metadata'),
        }),
      ));
    }),
  );

  register(
    'spiderbyte_list_artifacts',
    {
      title: 'List workspace artifacts',
      description:
        'Use when you need to discover local datasets, metrics, notebooks, visualizations, models, logs, or other persisted artifacts.',
      inputSchema: { ...workspaceSchema, kind: z.string().min(1).optional() },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_list_artifacts', args, extra, options, async (workspace) => {
      const artifacts = await workspace.handle.accessor.get(IWorkspaceArtifactService).list(optionalString(args, 'kind') as ArtifactKind | undefined);
      return redact(artifacts.slice(0, profile === 'curated' ? SPIDERBYTE_MCP_MAX_CURATED_ITEMS : undefined));
    }),
  );

  register(
    'spiderbyte_get_artifact',
    {
      title: 'Inspect a workspace artifact',
      description:
        'Use when you need artifact metadata, size, hash, run association, expiry, and source references without retrieving its bytes.',
      inputSchema: { ...workspaceSchema, artifact_id: z.string().min(1) },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_get_artifact', args, extra, options, async (workspace) => {
      const id = requireString(args, 'artifact_id');
      const artifact = await workspace.handle.accessor.get(IWorkspaceArtifactService).get(id);
      if (artifact === undefined) throw notFound('artifact', id);
      return redact(artifact);
    }),
  );

  register(
    'spiderbyte_get_artifact_lineage',
    {
      title: 'Inspect artifact lineage',
      description:
        'Use when you need upstream artifacts, downstream artifacts, and linked runs for a local result.',
      inputSchema: { ...workspaceSchema, artifact_id: z.string().min(1) },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_get_artifact_lineage', args, extra, options, async (workspace) => {
      const id = requireString(args, 'artifact_id');
      const lineage = await workspace.handle.accessor.get(IWorkspaceArtifactService).lineage(id);
      if (lineage === undefined) throw notFound('artifact lineage', id);
      return redact(lineage);
    }),
  );

  register(
    'spiderbyte_get_artifact_content',
    {
      title: 'Retrieve a bounded artifact range',
      description:
        'Use when you need a small authorized byte range from a local artifact; large content is returned out-of-band in MCP metadata and is never included by default.',
      inputSchema: {
        ...workspaceSchema,
        artifact_id: z.string().min(1),
        start: z.number().int().nonnegative().default(0),
        end: z.number().int().nonnegative().optional(),
      },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_get_artifact_content', args, extra, options, async (workspace) => {
      const start = optionalNumber(args, 'start') ?? 0;
      const requestedEnd = optionalNumber(args, 'end');
      const end = requestedEnd ?? start + SPIDERBYTE_MCP_MAX_ARTIFACT_BYTES - 1;
      if (end < start || end - start + 1 > SPIDERBYTE_MCP_MAX_ARTIFACT_BYTES) {
        throw invalid(`artifact ranges are limited to ${SPIDERBYTE_MCP_MAX_ARTIFACT_BYTES} bytes`);
      }
      const chunk = await workspace.handle.accessor.get(IWorkspaceArtifactService).downloadRange(
        requireString(args, 'artifact_id'),
        { start, end },
      );
      if (chunk === undefined) throw notFound('artifact', requireString(args, 'artifact_id'));
      return operationValue(
        redact({
          artifact: chunk.artifact,
          start: chunk.start,
          end: chunk.end,
          total_bytes: chunk.total_bytes,
          complete: chunk.complete,
          content_available_in_meta: true,
        }),
        { content_base64: chunk.content_base64 },
      );
    }),
  );

  register(
    'spiderbyte_list_runs',
    {
      title: 'List workspace runs',
      description:
        'Use when you need to inspect durable run status across a workspace or within one session.',
      inputSchema: {
        ...workspaceSchema,
        session_id: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_list_runs', args, extra, options, async (workspace) =>
      redact(await listWorkspaceRuns(core, workspace.id, optionalString(args, 'session_id'), optionalNumber(args, 'limit') ?? 50))),
  );

  register(
    'spiderbyte_get_run',
    {
      title: 'Inspect a durable run',
      description:
        'Use when you need the plan, lifecycle state, policy references, execution target, artifacts, or failure reason for one run.',
      inputSchema: { ...workspaceSchema, session_id: z.string().min(1), run_id: z.string().min(1) },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_get_run', args, extra, options, async (workspace) =>
      redact(await withSession(core, workspace.id, requireString(args, 'session_id'), async (session) => {
        const run = await session.accessor.get(ISessionRunService).get(requireString(args, 'run_id'));
        if (run === undefined) throw notFound('run', requireString(args, 'run_id'));
        return run;
      }))),
  );

  register(
    'spiderbyte_create_run',
    {
      title: 'Create a governed run',
      description:
        'Use when you need a durable queued run envelope for planning a local data or ML operation; creation does not submit hosted compute.',
      inputSchema: {
        ...workspaceSchema,
        session_id: z.string().min(1),
        parent_run_id: z.string().min(1).optional(),
        plan: z.array(z.record(z.string(), z.unknown())).optional(),
        execution_target_id: z.string().min(1).optional(),
        ...metadataSchema,
        ...idempotencySchema,
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (args, extra) => withWorkspaceTool('spiderbyte_create_run', args, extra, options, async (workspace) =>
      redact(await withSession(core, workspace.id, requireString(args, 'session_id'), async (session) =>
        session.accessor.get(ISessionRunService).create(runCreateInputSchema.parse({
          request_id: requestIdFor(args, 'run'),
          parent_run_id: optionalString(args, 'parent_run_id'),
          plan: optionalArray(args, 'plan'),
          execution_target_id: optionalString(args, 'execution_target_id'),
          metadata: optionalObject(args, 'metadata'),
        }))))),
  );

  register(
    'spiderbyte_transition_run',
    {
      title: 'Transition a durable run',
      description:
        'Use when you need to record a validated plan, approval state, running state, completion, or failure for a local run.',
      inputSchema: {
        ...workspaceSchema,
        session_id: z.string().min(1),
        run_id: z.string().min(1),
        status: z.enum(['queued', 'planning', 'awaiting_approval', 'running', 'succeeded', 'failed', 'cancelled']),
        status_reason: z.string().max(2_000).optional(),
        plan: z.array(z.record(z.string(), z.unknown())).optional(),
        output_artifacts: z.array(z.record(z.string(), z.unknown())).optional(),
        policy_decision_ids: z.array(z.string().min(1)).optional(),
        execution_target_id: z.string().min(1).optional(),
        ...metadataSchema,
        ...idempotencySchema,
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (args, extra) => withWorkspaceTool('spiderbyte_transition_run', args, extra, options, async (workspace) =>
      redact(await withSession(core, workspace.id, requireString(args, 'session_id'), async (session) =>
        session.accessor.get(ISessionRunService).transition(
          requireString(args, 'run_id'),
          runTransitionInputSchema.parse({
            request_id: requestIdFor(args, 'run_transition'),
            status: requireString(args, 'status'),
            status_reason: optionalString(args, 'status_reason'),
            plan: optionalArray(args, 'plan'),
            output_artifacts: optionalArray(args, 'output_artifacts'),
            policy_decision_ids: optionalStringArray(args, 'policy_decision_ids'),
            execution_target_id: optionalString(args, 'execution_target_id'),
            metadata: optionalObject(args, 'metadata'),
          }),
        )))),
  );

  for (const action of ['cancel', 'resume', 'retry', 'rerun'] as const) {
    const name = `spiderbyte_${action}_run`;
    register(
      name,
      {
        title: `${action.charAt(0).toUpperCase()}${action.slice(1)} a durable run`,
        description:
          `Use when you need to ${action} a local durable run after inspecting its current state; ${action === 'cancel' || action === 'resume' ? 'confirm this action before execution.' : 'retries are idempotent when an idempotency_key is supplied.'}`,
        inputSchema: {
          ...workspaceSchema,
          session_id: z.string().min(1),
          run_id: z.string().min(1),
          ...idempotencySchema,
          ...(action === 'cancel' || action === 'resume' ? confirmationSchema : {}),
        },
        annotations: {
          readOnlyHint: false,
          openWorldHint: false,
          destructiveHint: action === 'cancel',
          idempotentHint: action !== 'retry' && action !== 'rerun',
        },
      },
      (args, extra) => withWorkspaceTool(name, args, extra, options, async (workspace) => {
        if (action === 'cancel' || action === 'resume') requireConfirmation(args);
        const input = runActionInputSchema.parse({ request_id: requestIdFor(args, `run_${action}`) });
        return redact(await withSession(core, workspace.id, requireString(args, 'session_id'), async (session) => {
          const runs = session.accessor.get(ISessionRunService);
          const runId = requireString(args, 'run_id');
          const result = action === 'cancel'
            ? await runs.cancel(runId, input)
            : action === 'resume'
              ? await runs.resume(runId, input)
              : action === 'retry'
                ? await runs.retry(runId, input)
                : await runs.rerun(runId, input);
          if (result === undefined) throw notFound('run', runId);
          return result;
        }));
      }),
    );
  }

  register(
    'spiderbyte_compare_runs',
    {
      title: 'Compare local runs',
      description:
        'Use when you need a bounded side-by-side status and artifact comparison for multiple local runs in one workspace.',
      inputSchema: { ...workspaceSchema, run_ids: z.array(z.string().min(1)).min(2).max(20) },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_compare_runs', args, extra, options, async (workspace) => {
      const ids = requireStringArray(args, 'run_ids');
      const runs = await listWorkspaceRuns(core, workspace.id, undefined, 100);
      const byId = new Map(runs.map((run) => [run.id, run]));
      return redact({
        runs: ids.map((id) => byId.get(id) ?? { id, status: 'not_found' }),
        missing: ids.filter((id) => !byId.has(id)),
      });
    }),
  );

  register(
    'spiderbyte_analyze_dataset',
    {
      title: 'Analyze dataset quality',
      description:
        'Use when you need a durable quality analysis of a local dataset, including row/column coverage and report artifacts.',
      inputSchema: {
        ...workspaceSchema,
        dataset_id: z.string().min(1),
        run_id: z.string().min(1),
        kind: z.enum(['summary', 'visualization', 'notebook']).default('summary'),
        dataset_version: z.number().int().positive().optional(),
        columns: z.array(z.string().min(1)).optional(),
        group_by: z.array(z.string().min(1)).optional(),
        execution_target_id: z.string().min(1).optional(),
        policy_decision_id: z.string().min(1).optional(),
        ...metadataSchema,
        ...idempotencySchema,
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (args, extra) => withWorkspaceTool('spiderbyte_analyze_dataset', args, extra, options, async (workspace) =>
      redact(await workspace.handle.accessor.get(IWorkspaceMlService).analyze(analysisCreateInputSchema.parse({
        request_id: requestIdFor(args, 'analysis'),
        run_id: requireString(args, 'run_id'),
        dataset_id: requireString(args, 'dataset_id'),
        kind: optionalString(args, 'kind') ?? 'summary',
        dataset_version: optionalNumber(args, 'dataset_version'),
        columns: optionalStringArray(args, 'columns'),
        group_by: optionalStringArray(args, 'group_by'),
        execution_target_id: optionalString(args, 'execution_target_id'),
        dataset_policy_decision_id: optionalString(args, 'policy_decision_id'),
        metadata: optionalObject(args, 'metadata'),
      })))),
  );

  register(
    'spiderbyte_list_analyses',
    {
      title: 'List dataset analyses',
      description:
        'Use when you need to find previously generated local dataset quality reports, summaries, visualizations, or notebook analyses.',
      inputSchema: { ...workspaceSchema },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_list_analyses', args, extra, options, async (workspace) =>
      redact(await workspace.handle.accessor.get(IWorkspaceMlService).listAnalyses())),
  );

  register(
    'spiderbyte_get_analysis',
    {
      title: 'Inspect a dataset analysis',
      description:
        'Use when you need the authoritative result, metrics, report artifact references, and execution metadata for one local dataset analysis.',
      inputSchema: { ...workspaceSchema, analysis_id: z.string().min(1) },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_get_analysis', args, extra, options, async (workspace) => {
      const id = requireString(args, 'analysis_id');
      const analysis = await workspace.handle.accessor.get(IWorkspaceMlService).getAnalysis(id);
      if (analysis === undefined) throw notFound('analysis', id);
      return redact(analysis);
    }),
  );

  register(
    'spiderbyte_list_experiments',
    {
      title: 'List ML experiments',
      description:
        'Use when you need to discover local experiments and their dataset, run, metric, and model relationships.',
      inputSchema: { ...workspaceSchema },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_list_experiments', args, extra, options, async (workspace) =>
      redact(await workspace.handle.accessor.get(IWorkspaceMlService).listExperiments())),
  );

  register(
    'spiderbyte_get_experiment',
    {
      title: 'Inspect an ML experiment',
      description:
        'Use when you need the complete local experiment definition, current state, linked runs, training runs, and model versions.',
      inputSchema: { ...workspaceSchema, experiment_id: z.string().min(1) },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_get_experiment', args, extra, options, async (workspace) => {
      const id = requireString(args, 'experiment_id');
      const ml = workspace.handle.accessor.get(IWorkspaceMlService);
      const experiment = await ml.getExperiment(id);
      if (experiment === undefined) throw notFound('experiment', id);
      return redact({
        experiment,
        training_runs: await ml.listTrainingRuns(id),
        evaluations: await ml.listEvaluations(id),
        models: (await ml.listModels()).filter((model) => model.experiment_id === id),
      });
    }),
  );

  register(
    'spiderbyte_create_experiment',
    {
      title: 'Create an ML experiment',
      description:
        'Use when you need to define a local experiment with a dataset, target, features, algorithm, metrics, and optional execution target.',
      inputSchema: {
        ...workspaceSchema,
        name: z.string().min(1).max(500),
        dataset_id: z.string().min(1),
        dataset_version: z.number().int().positive().optional(),
        target: z.string().min(1).max(500),
        features: z.array(z.string().min(1)).min(1).max(256),
        task: z.enum(['classification', 'regression', 'custom']),
        algorithm: z.string().min(1).max(256),
        metrics: z.array(z.record(z.string(), z.unknown())).min(1).max(32),
        hyperparameters: z.record(z.string(), z.unknown()).default({}),
        seed: z.number().int().nonnegative().default(0),
        run_id: z.string().min(1).optional(),
        execution_target_id: z.string().min(1).optional(),
        dataset_policy_decision_id: z.string().min(1).optional(),
        model_policy_decision_id: z.string().min(1).optional(),
        ...metadataSchema,
        ...idempotencySchema,
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (args, extra) => withWorkspaceTool('spiderbyte_create_experiment', args, extra, options, async (workspace) =>
      redact(await workspace.handle.accessor.get(IWorkspaceMlService).createExperiment(experimentCreateInputSchema.parse({
        request_id: requestIdFor(args, 'experiment'),
        run_id: optionalString(args, 'run_id'),
        name: requireString(args, 'name'),
        dataset_id: requireString(args, 'dataset_id'),
        dataset_version: optionalNumber(args, 'dataset_version'),
        dataset_policy_decision_id: optionalString(args, 'dataset_policy_decision_id'),
        model_policy_decision_id: optionalString(args, 'model_policy_decision_id'),
        target: requireString(args, 'target'),
        features: requireStringArray(args, 'features'),
        task: requireString(args, 'task'),
        algorithm: requireString(args, 'algorithm'),
        execution_target_id: optionalString(args, 'execution_target_id'),
        metrics: optionalArray(args, 'metrics'),
        hyperparameters: optionalObject(args, 'hyperparameters') ?? {},
        seed: optionalNumber(args, 'seed') ?? 0,
        metadata: optionalObject(args, 'metadata'),
      })))),
  );

  register(
    'spiderbyte_list_training_runs',
    {
      title: 'List training runs',
      description:
        'Use when you need local training status, executor type, metrics, checkpoints, and model artifact references.',
      inputSchema: { ...workspaceSchema, experiment_id: z.string().min(1).optional() },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_list_training_runs', args, extra, options, async (workspace) =>
      redact(await workspace.handle.accessor.get(IWorkspaceMlService).listTrainingRuns(optionalString(args, 'experiment_id')))),
  );

  register(
    'spiderbyte_get_training_run',
    {
      title: 'Inspect a training run',
      description:
        'Use when you need one local training run’s status, metrics, checkpoints, executor, and linked model artifact references.',
      inputSchema: { ...workspaceSchema, training_run_id: z.string().min(1) },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_get_training_run', args, extra, options, async (workspace) => {
      const id = requireString(args, 'training_run_id');
      const training = await workspace.handle.accessor.get(IWorkspaceMlService).getTrainingRun(id);
      if (training === undefined) throw notFound('training run', id);
      return redact(training);
    }),
  );

  register(
    'spiderbyte_start_training',
    {
      title: 'Start local or customer-managed training',
      description:
        'Use when you need to start an ML training run through a configured local or customer-managed execution target; confirm because this may consume compute.',
      inputSchema: {
        ...workspaceSchema,
        experiment_id: z.string().min(1),
        run_id: z.string().min(1),
        execution_target_id: z.string().min(1).optional(),
        execution_target_policy_decision_id: z.string().min(1).optional(),
        dataset_policy_decision_id: z.string().min(1).optional(),
        model_policy_decision_id: z.string().min(1).optional(),
        ...metadataSchema,
        ...idempotencySchema,
        ...confirmationSchema,
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (args, extra) => withWorkspaceTool('spiderbyte_start_training', args, extra, options, async (workspace) => {
      requireConfirmation(args);
      const result = await workspace.handle.accessor.get(IWorkspaceMlService).startTraining(
        requireString(args, 'experiment_id'),
        trainingStartInputSchema.parse({
          request_id: requestIdFor(args, 'training'),
          run_id: requireString(args, 'run_id'),
          execution_target_id: optionalString(args, 'execution_target_id'),
          execution_target_policy_decision_id: optionalString(args, 'execution_target_policy_decision_id'),
          dataset_policy_decision_id: optionalString(args, 'dataset_policy_decision_id'),
          model_policy_decision_id: optionalString(args, 'model_policy_decision_id'),
          metadata: optionalObject(args, 'metadata'),
        }),
      );
      if (result === undefined) throw notFound('experiment', requireString(args, 'experiment_id'));
      return redact(result);
    }),
  );

  register(
    'spiderbyte_train_baseline_model',
    {
      title: 'Train a baseline model',
      description:
        'Use when you need the complete local dataset-to-baseline-model workflow: resolve or ingest a dataset, profile it, analyze it, train, evaluate, register the model, and return durable artifact IDs.',
      inputSchema: {
        ...workspaceSchema,
        session_id: z.string().min(1),
        dataset_id: z.string().min(1).optional(),
        dataset_name: z.string().min(1).max(500).optional(),
        format: z.enum(['csv', 'jsonl']).optional(),
        source_path: z.string().min(1).optional(),
        content_base64: z.string().max(14_000_000).optional(),
        dataset_version: z.number().int().positive().optional(),
        dataset_policy_decision_id: z.string().min(1).optional(),
        model_policy_decision_id: z.string().min(1).optional(),
        execution_target_policy_decision_id: z.string().min(1).optional(),
        target: z.string().min(1).max(500),
        features: z.array(z.string().min(1).max(500)).min(1).max(256),
        task: z.enum(['classification', 'regression']),
        algorithm: z.string().min(1).max(256).optional(),
        experiment_name: z.string().min(1).max(500).optional(),
        model_name: z.string().min(1).max(256).optional(),
        execution_target_id: z.string().min(1).optional(),
        metrics: z.array(baselineMetricSchema).min(1).max(32).optional(),
        hyperparameters: z.record(z.string(), z.unknown()).optional(),
        seed: z.number().int().nonnegative().optional(),
        ...metadataSchema,
        ...idempotencySchema,
        ...confirmationSchema,
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (args, extra) => withWorkspaceTool('spiderbyte_train_baseline_model', args, extra, options, async (workspace) => {
      requireConfirmation(args);
      const sessionId = requireString(args, 'session_id');
      const requestId = requestIdFor(args, 'baseline', extra.requestId);
      const task = requireString(args, 'task') as 'classification' | 'regression';
      const metrics: readonly ExperimentMetricSpec[] = args['metrics'] === undefined
        ? task === 'classification'
          ? [{ name: 'accuracy', higher_is_better: true }]
          : [{ name: 'mae', higher_is_better: false }, { name: 'rmse', higher_is_better: false }]
        : z.array(baselineMetricSchema).parse(args['metrics']) as readonly ExperimentMetricSpec[];
      const runs = await withSession(core, workspace.id, sessionId, async (session) => {
        const runService = session.accessor.get(ISessionRunService);
        const run = await runService.create(runCreateInputSchema.parse({
          request_id: requestId,
          plan: [{ id: 'baseline_workflow', title: 'Execute the baseline ML workflow', status: 'pending' }],
          execution_target_id: optionalString(args, 'execution_target_id'),
          metadata: { operation: 'baseline_workflow', source: 'curated_mcp' },
        }));

        // A completed or failed Run returned for the same request ID is an
        // idempotent replay. The process-wide claim also coalesces concurrent
        // retries on one daemon; durable restart recovery belongs to the
        // unified Attempt phase.
        if (run.status !== 'queued') return { run, replayed: true as const };
        const activeClaim = CURATED_BASELINE_CLAIMS.get(run.id);
        if (activeClaim !== undefined) return activeClaim;
        const execution = (async (): Promise<unknown> => {
          const started = await runService.transition(run.id, runTransitionInputSchema.parse({
            request_id: childRequestId(requestId, 'start'),
            status: 'running',
            plan: [{ id: 'baseline_workflow', title: 'Execute the baseline ML workflow', status: 'running' }],
            execution_target_id: optionalString(args, 'execution_target_id'),
          }));
          if (started === undefined) throw notFound('run', run.id);

          try {
            const workflow = await executeBaselineWorkflow({
              datasets: workspace.handle.accessor.get(IWorkspaceDatasetService),
              ml: workspace.handle.accessor.get(IWorkspaceMlService),
              artifacts: workspace.handle.accessor.get(IWorkspaceArtifactService),
            }, {
              requestPrefix: requestId.slice(0, 220),
              runId: run.id,
              datasetId: optionalString(args, 'dataset_id'),
              datasetName: optionalString(args, 'dataset_name'),
              format: optionalString(args, 'format') as 'csv' | 'jsonl' | undefined,
              sourcePath: optionalString(args, 'source_path'),
              contentBase64: optionalString(args, 'content_base64'),
              datasetVersion: optionalNumber(args, 'dataset_version'),
              datasetPolicyDecisionId: optionalString(args, 'dataset_policy_decision_id'),
              modelPolicyDecisionId: optionalString(args, 'model_policy_decision_id'),
              executionTargetPolicyDecisionId: optionalString(args, 'execution_target_policy_decision_id'),
              target: requireString(args, 'target'),
              features: requireStringArray(args, 'features'),
              task,
              algorithm: optionalString(args, 'algorithm'),
              experimentName: optionalString(args, 'experiment_name'),
              modelName: optionalString(args, 'model_name'),
              executionTargetId: optionalString(args, 'execution_target_id'),
              metrics,
              hyperparameters: optionalObject(args, 'hyperparameters'),
              seed: optionalNumber(args, 'seed'),
              metadata: optionalObject(args, 'metadata'),
            },
            undefined,
          );
          const completed = await runService.transition(run.id, runTransitionInputSchema.parse({
            request_id: childRequestId(requestId, 'complete'),
            status: 'succeeded',
            plan: [{ id: 'baseline_workflow', title: 'Execute the baseline ML workflow', status: 'completed' }],
            output_artifacts: workflow.artifacts.map((artifact) => ({ id: artifact.id, version: artifact.version })),
          }));
          return {
            run: completed ?? run,
            replayed: false as const,
            workflow: baselineWorkflowProjection(workflow),
            artifact_ids: workflow.artifacts.map((artifact) => artifact.id),
          };
        } catch (error) {
          await runService.transition(run.id, runTransitionInputSchema.parse({
            request_id: childRequestId(requestId, 'failed'),
            status: 'failed',
            plan: [{ id: 'baseline_workflow', title: 'Execute the baseline ML workflow', status: 'failed' }],
            status_reason: error instanceof Error ? error.message.slice(0, 2_000) : 'baseline workflow failed',
          })).catch(() => undefined);
          throw error;
        }
        })();
        CURATED_BASELINE_CLAIMS.set(run.id, execution);
        try {
          return await execution;
        } finally {
          if (CURATED_BASELINE_CLAIMS.get(run.id) === execution) CURATED_BASELINE_CLAIMS.delete(run.id);
        }
      });
      return redact(runs);
    }),
  );

  register(
    'spiderbyte_cancel_training',
    {
      title: 'Cancel training',
      description:
        'Use when you need to stop an active local or customer-managed training run after confirming the cancellation.',
      inputSchema: {
        ...workspaceSchema,
        training_run_id: z.string().min(1),
        ...idempotencySchema,
        ...confirmationSchema,
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    (args, extra) => withWorkspaceTool('spiderbyte_cancel_training', args, extra, options, async (workspace) => {
      requireConfirmation(args);
      const result = await workspace.handle.accessor.get(IWorkspaceMlService).cancelTraining(
        requireString(args, 'training_run_id'),
        trainingCancelInputSchema.parse({ request_id: requestIdFor(args, 'training_cancel') }),
      );
      if (result === undefined) throw notFound('training run', requireString(args, 'training_run_id'));
      return redact(result);
    }),
  );

  register(
    'spiderbyte_list_evaluations',
    {
      title: 'List model evaluations',
      description:
        'Use when you need local evaluation results, metrics, recommendations, and limitation records.',
      inputSchema: { ...workspaceSchema, experiment_id: z.string().min(1).optional() },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_list_evaluations', args, extra, options, async (workspace) =>
      redact(await workspace.handle.accessor.get(IWorkspaceMlService).listEvaluations(optionalString(args, 'experiment_id')))),
  );

  register(
    'spiderbyte_get_evaluation',
    {
      title: 'Inspect a model evaluation',
      description:
        'Use when you need one local evaluation’s metrics, recommendation, limitations, and linked experiment or model context.',
      inputSchema: { ...workspaceSchema, evaluation_id: z.string().min(1) },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_get_evaluation', args, extra, options, async (workspace) => {
      const id = requireString(args, 'evaluation_id');
      const evaluation = await workspace.handle.accessor.get(IWorkspaceMlService).getEvaluation(id);
      if (evaluation === undefined) throw notFound('evaluation', id);
      return redact(evaluation);
    }),
  );

  register(
    'spiderbyte_compare_experiments',
    {
      title: 'Compare experiments',
      description:
        'Use when you need a durable comparison artifact across two or more local experiments with compatible metrics.',
      inputSchema: {
        ...workspaceSchema,
        experiment_ids: z.array(z.string().min(1)).min(2).max(100),
        run_id: z.string().min(1),
        model_policy_decision_id: z.string().min(1).optional(),
        ...metadataSchema,
        ...idempotencySchema,
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (args, extra) => withWorkspaceTool('spiderbyte_compare_experiments', args, extra, options, async (workspace) =>
      redact(await workspace.handle.accessor.get(IWorkspaceMlService).compare(experimentCompareInputSchema.parse({
        request_id: requestIdFor(args, 'experiment_compare'),
        experiment_ids: requireStringArray(args, 'experiment_ids'),
        run_id: requireString(args, 'run_id'),
        model_policy_decision_id: optionalString(args, 'model_policy_decision_id'),
        metadata: optionalObject(args, 'metadata'),
      })))),
  );

  register(
    'spiderbyte_list_models',
    {
      title: 'List registered models',
      description:
        'Use when you need local model versions, stages, metrics, experiments, and artifact lineage references.',
      inputSchema: { ...workspaceSchema, model_name: z.string().min(1).optional() },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_list_models', args, extra, options, async (workspace) =>
      redact(await workspace.handle.accessor.get(IWorkspaceMlService).listModels(optionalString(args, 'model_name')))),
  );

  register(
    'spiderbyte_get_model',
    {
      title: 'Inspect a registered model',
      description:
        'Use when you need one local model version’s stage, metrics, lineage, artifact, and governance metadata.',
      inputSchema: { ...workspaceSchema, model_id: z.string().min(1) },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_get_model', args, extra, options, async (workspace) => {
      const id = requireString(args, 'model_id');
      const model = await workspace.handle.accessor.get(IWorkspaceMlService).getModel(id);
      if (model === undefined) throw notFound('model', id);
      return redact(model);
    }),
  );

  register(
    'spiderbyte_register_model',
    {
      title: 'Register a model version',
      description:
        'Use when you need to register a locally produced model artifact with experiment, training, evaluation, and metric lineage.',
      inputSchema: {
        ...workspaceSchema,
        model_name: z.string().min(1).max(256),
        artifact_id: z.string().min(1),
        experiment_id: z.string().min(1),
        training_run_id: z.string().min(1),
        evaluation_id: z.string().min(1).optional(),
        metrics: z.record(z.string(), z.number()).default({}),
        run_id: z.string().min(1).optional(),
        model_policy_decision_id: z.string().min(1).optional(),
        ...metadataSchema,
        ...idempotencySchema,
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (args, extra) => withWorkspaceTool('spiderbyte_register_model', args, extra, options, async (workspace) =>
      redact(await workspace.handle.accessor.get(IWorkspaceMlService).registerModel(modelRegisterInputSchema.parse({
        request_id: requestIdFor(args, 'model'),
        run_id: optionalString(args, 'run_id'),
        model_policy_decision_id: optionalString(args, 'model_policy_decision_id'),
        model_name: requireString(args, 'model_name'),
        artifact_id: requireString(args, 'artifact_id'),
        experiment_id: requireString(args, 'experiment_id'),
        training_run_id: requireString(args, 'training_run_id'),
        evaluation_id: optionalString(args, 'evaluation_id'),
        metrics: optionalNumberMap(args, 'metrics') ?? {},
        metadata: optionalObject(args, 'metadata'),
      })))),
  );

  register(
    'spiderbyte_stage_model',
    {
      title: 'Change a model stage',
      description:
        'Use when you need to move a registered local model between candidate, validated, production, or archived stages after confirming the governance decision.',
      inputSchema: {
        ...workspaceSchema,
        model_id: z.string().min(1),
        stage: z.enum(['candidate', 'validated', 'production', 'archived']),
        run_id: z.string().min(1).optional(),
        model_policy_decision_id: z.string().min(1).optional(),
        ...metadataSchema,
        ...idempotencySchema,
        ...confirmationSchema,
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    (args, extra) => withWorkspaceTool('spiderbyte_stage_model', args, extra, options, async (workspace) => {
      requireConfirmation(args);
      const modelId = requireString(args, 'model_id');
      const result = await workspace.handle.accessor.get(IWorkspaceMlService).updateModelStage(
        modelId,
        modelStageInputSchema.parse({
          request_id: requestIdFor(args, 'model_stage'),
          run_id: optionalString(args, 'run_id'),
          model_policy_decision_id: optionalString(args, 'model_policy_decision_id'),
          stage: requireString(args, 'stage'),
          metadata: optionalObject(args, 'metadata'),
        }),
      );
      if (result === undefined) throw notFound('model', modelId);
      return redact(result);
    }),
  );

  register(
    'spiderbyte_list_provider_connections',
    {
      title: 'List provider connections',
      description:
        'Use when you need to inspect configured local or BYOK provider connections and their non-secret validation state; credentials are never returned.',
      inputSchema: { ...workspaceSchema },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_list_provider_connections', args, extra, options, async (workspace) =>
      redact(await workspace.handle.accessor.get(IWorkspaceProviderConnectionService).list())),
  );

  register(
    'spiderbyte_get_provider_connection',
    {
      title: 'Inspect a provider connection',
      description:
        'Use when you need one configured local or BYOK provider connection’s non-secret state; secret material is never returned.',
      inputSchema: { ...workspaceSchema, connection_id: z.string().min(1) },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_get_provider_connection', args, extra, options, async (workspace) => {
      const id = requireString(args, 'connection_id');
      const connection = await workspace.handle.accessor.get(IWorkspaceProviderConnectionService).get(id);
      if (connection === undefined) throw notFound('provider connection', id);
      return redact(connection);
    }),
  );

  register(
    'spiderbyte_list_execution_targets',
    {
      title: 'List execution targets',
      description:
        'Use when you need to inspect local and explicitly registered customer-managed execution targets; managed hosted machines are not included.',
      inputSchema: { ...workspaceSchema },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_list_execution_targets', args, extra, options, async (workspace) => {
      const targets = await workspace.handle.accessor.get(IWorkspaceExecutionTargetService).list();
      return redact(targets.slice(0, profile === 'curated' ? SPIDERBYTE_MCP_MAX_CURATED_ITEMS : undefined));
    }),
  );

  register(
    'spiderbyte_get_execution_target',
    {
      title: 'Inspect an execution target',
      description:
        'Use when you need one local or customer-managed execution target’s readiness, capabilities, policy references, and lease state.',
      inputSchema: { ...workspaceSchema, target_id: z.string().min(1) },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_get_execution_target', args, extra, options, async (workspace) => {
      const id = requireString(args, 'target_id');
      const target = await workspace.handle.accessor.get(IWorkspaceExecutionTargetService).get(id);
      if (target === undefined) throw notFound('execution target', id);
      return redact(target);
    }),
  );

  register(
    'spiderbyte_list_policies',
    {
      title: 'List policy decisions',
      description:
        'Use when you need to inspect local policy outcomes, approval states, reasons, and audit references before acting.',
      inputSchema: { ...workspaceSchema },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_list_policies', args, extra, options, async (workspace) =>
      redact(await workspace.handle.accessor.get(IWorkspacePolicyService).list())),
  );

  register(
    'spiderbyte_explain_policy',
    {
      title: 'Explain a policy decision',
      description:
        'Use when you need the durable reason and state for one local policy decision.',
      inputSchema: { ...workspaceSchema, decision_id: z.string().min(1) },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_explain_policy', args, extra, options, async (workspace) => {
      const id = requireString(args, 'decision_id');
      const decision = await workspace.handle.accessor.get(IWorkspacePolicyService).explain(id);
      if (decision === undefined) throw notFound('policy decision', id);
      return redact(decision);
    }),
  );

  register(
    'spiderbyte_request_approval',
    {
      title: 'Evaluate a governed action',
      description:
        'Use when you need SpiderByte to evaluate a local capability/action request and return allow, deny, or approval-required before execution.',
      inputSchema: {
        ...workspaceSchema,
        capability: z.enum(['shell', 'filesystem', 'network', 'credentials', 'dataset', 'connector', 'model', 'cloud', 'serving', 'deploy']),
        action: z.string().min(1).max(500),
        run_id: z.string().min(1).optional(),
        requested_by: z.enum(['user', 'agent', 'system', 'automation', 'policy']).default('agent'),
        ...metadataSchema,
        ...idempotencySchema,
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (args, extra) => withWorkspaceTool('spiderbyte_request_approval', args, extra, options, async (workspace) =>
      redact(await workspace.handle.accessor.get(IWorkspacePolicyService).evaluate(policyEvaluateInputSchema.parse({
        request_id: requestIdFor(args, 'policy'),
        run_id: optionalString(args, 'run_id'),
        capability: requireString(args, 'capability'),
        action: requireString(args, 'action'),
        requested_by: optionalString(args, 'requested_by') ?? 'agent',
        metadata: optionalObject(args, 'metadata'),
      })))),
  );

  for (const decisionAction of ['approve', 'deny'] as const) {
    const name = `spiderbyte_${decisionAction}_approval`;
    register(
      name,
      {
        title: `${decisionAction.charAt(0).toUpperCase()}${decisionAction.slice(1)} a policy decision`,
        description:
          `Use when you have explicit confirmation to ${decisionAction} a local policy decision; never infer confirmation from an earlier analysis.`,
        inputSchema: {
          ...workspaceSchema,
          decision_id: z.string().min(1),
          reason: z.string().min(1).max(2_000).optional(),
          ...idempotencySchema,
          ...confirmationSchema,
        },
        annotations: {
          readOnlyHint: false,
          openWorldHint: false,
          destructiveHint: decisionAction === 'deny',
          idempotentHint: true,
        },
      },
      (args, extra) => withWorkspaceTool(name, args, extra, options, async (workspace) => {
        requireConfirmation(args);
        const id = requireString(args, 'decision_id');
        const input = policyDecisionResolveInputSchema.parse({
          request_id: requestIdFor(args, `policy_${decisionAction}`),
          decided_by: 'user',
          reason: optionalString(args, 'reason'),
        });
        const policy = workspace.handle.accessor.get(IWorkspacePolicyService);
        const result = decisionAction === 'approve'
          ? await policy.approve(id, input)
          : await policy.deny(id, input);
        if (result === undefined) throw notFound('policy decision', id);
        return redact(result);
      }),
    );
  }

  register(
    'spiderbyte_get_budget_status',
    {
      title: 'Inspect workspace budgets',
      description:
        'Use when you need local budget limits, reservations, consumption, warnings, and blocked states before a costly operation.',
      inputSchema: { ...workspaceSchema },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_get_budget_status', args, extra, options, async (workspace) =>
      redact(await workspace.handle.accessor.get(IWorkspaceBudgetService).status())),
  );

  register(
    'spiderbyte_get_usage',
    {
      title: 'Inspect workspace usage',
      description:
        'Use when you need local model, execution, artifact-storage, and plugin-usage totals for a bounded time period.',
      inputSchema: {
        ...workspaceSchema,
        period_start: z.string().datetime().optional(),
        period_end: z.string().datetime().optional(),
      },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_get_usage', args, extra, options, async (workspace) =>
      redact(await workspace.handle.accessor.get(IWorkspaceUsageService).usageSummary({
        period_start: optionalString(args, 'period_start'),
        period_end: optionalString(args, 'period_end'),
      }))),
  );

  register(
    'spiderbyte_list_events',
    {
      title: 'Inspect platform audit events',
      description:
        'Use when you need the local append-only platform event history for runs, artifacts, policies, ML operations, and MCP invocations.',
      inputSchema: { ...workspaceSchema, after_sequence: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(500).default(100) },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('spiderbyte_list_events', args, extra, options, async (workspace) =>
      redact(await workspace.handle.accessor.get(IWorkspacePlatformEventService).replay(
        optionalNumber(args, 'after_sequence') ?? 0,
        optionalNumber(args, 'limit') ?? 100,
      ))),
  );

  register(
    'spiderbyte_explain_unavailable',
    {
      title: 'Explain an unavailable capability',
      description:
        'Use when a requested workflow may depend on hosted infrastructure, credentials, provider adapters, or enterprise controls and you need the exact current status and next boundary.',
      inputSchema: {
        capability: z.enum([
          'estimate_hosted_compute',
          'list_compute_providers',
          'list_compute_profiles',
          'submit_hosted_job',
          'inspect_hosted_job',
          'cancel_hosted_job',
          'hosted_job_logs',
          'hosted_job_outputs',
          'list_available_machines',
          'inspect_machine_availability',
          'hosted_identity',
          'billing',
          'team_membership',
          'sso_scim',
          'enterprise_audit_retention',
          'private_deployment',
          'provider_oauth',
        ]),
      },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => invokeTool('spiderbyte_explain_unavailable', extra, async () => {
      const requested = requireString(args, 'capability');
      const status = requested === 'provider_oauth'
        ? 'provider-unavailable'
        : requested === 'sso_scim' || requested === 'enterprise_audit_retention'
          ? 'enterprise-only'
          : requested === 'hosted_identity' || requested === 'billing' || requested === 'team_membership'
            ? 'hosted-required'
            : 'hosted-required';
      return operationValue(
        {
          capability: requested,
          status,
          implemented: false,
          message: unavailableMessage(requested),
          local_alternative: localAlternative(requested),
        },
        undefined,
        status,
      );
    }),
  );

  register(
    'search',
    {
      title: 'Search SpiderByte workspace records',
      description:
        'Use when you need concise records matching a query across local sessions, datasets, experiments, artifacts, models, and runs.',
      inputSchema: { ...workspaceSchema, query: z.string().min(1).max(500), limit: z.number().int().min(1).max(50).default(20) },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('search', args, extra, options, async (workspace) =>
      searchWorkspace(core, workspace, requireString(args, 'query'), optionalNumber(args, 'limit') ?? 20)),
  );

  register(
    'fetch',
    {
      title: 'Fetch a SpiderByte record',
      description:
        'Use when you need authoritative details for a stable SpiderByte search identifier such as a dataset, artifact, experiment, model, run, or session URI.',
      inputSchema: { ...workspaceSchema, id: z.string().min(1) },
      annotations: readOnlyAnnotations(),
    },
    (args, extra) => withWorkspaceTool('fetch', args, extra, options, async (workspace) =>
      fetchWorkspace(core, workspace, requireString(args, 'id'))),
  );

  return server;
}

function readOnlyAnnotations(): {
  readonly readOnlyHint: true;
  readonly openWorldHint: false;
  readonly destructiveHint: false;
  readonly idempotentHint: true;
} {
  return {
    readOnlyHint: true,
    openWorldHint: false,
    destructiveHint: false,
    idempotentHint: true,
  };
}

async function invokeTool(
  name: string,
  extra: ToolExtra,
  operation: () => Promise<unknown>,
): Promise<CallToolResult> {
  const requestId = requestIdFor({}, name, extra.requestId);
  try {
    const result = await withDeadline(operation(), extra.signal);
    const value = isOperationValue(result) ? result : operationValue(result);
    return successResult(requestId, value.data, value.meta, undefined, value.capabilityStatus);
  } catch (error) {
    return errorResult(requestId, error);
  }
}

async function withWorkspaceTool(
  name: string,
  args: Record<string, unknown>,
  extra: ToolExtra,
  options: SpyderbyteMcpOptions,
  operation: (workspace: WorkspaceContext) => Promise<unknown>,
): Promise<CallToolResult> {
  const requestId = requestIdFor(args, name, extra.requestId);
  let audit: { readonly events: IWorkspacePlatformEventService; readonly invocationId: string } | undefined;
  try {
    const workspace = await resolveWorkspace(options, args);
    await assertWorkspaceAuthorization(options.core, {
      workspaceId: workspace.id,
      requestId,
      capability: mcpCapabilityForTool(name),
      actorId: options.actorId,
      executionTargetId: optionalString(args, 'execution_target_id') ?? optionalString(args, 'target_id'),
    });
    const events = workspace.handle.accessor.get(IWorkspacePlatformEventService);
    const invocationId = `mcp_${ulid()}`;
    audit = { events, invocationId };
    await events.append({
      event_type: 'mcp_invocation.created',
      entity_type: 'mcp_invocation',
      entity_id: invocationId,
      request_id: requestId,
      actor: 'agent',
      payload: {
        tool_name: name,
        mode: options.mode,
        client: options.clientName ?? 'unknown',
        actor_id: resolveLocalActorId(options.actorId),
      },
    });
    const result = await withDeadline(operation(workspace), extra.signal);
    const value = isOperationValue(result) ? result : operationValue(result);
    await appendInvocationOutcome(events, invocationId, requestId, name, 'completed', options.logger);
    return successResult(requestId, value.data, value.meta, workspace.id, value.capabilityStatus);
  } catch (error) {
    if (audit !== undefined) {
      await appendInvocationOutcome(audit.events, audit.invocationId, requestId, name, 'failed', options.logger);
    }
    return errorResult(requestId, error);
  }
}

async function appendInvocationOutcome(
  events: IWorkspacePlatformEventService,
  invocationId: string,
  requestId: string,
  toolName: string,
  outcome: 'completed' | 'failed',
  logger?: ServerLogger,
): Promise<void> {
  try {
    await events.append({
      event_type: `mcp_invocation.${outcome}`,
      entity_type: 'mcp_invocation',
      entity_id: invocationId,
      request_id: requestId,
      actor: 'agent',
      payload: { tool_name: toolName, outcome },
    });
  } catch (error) {
    logger?.warn({ err: error instanceof Error ? error.message : String(error), toolName }, 'MCP audit completion append failed');
  }
}

async function resolveWorkspace(
  options: SpyderbyteMcpOptions,
  args: Record<string, unknown>,
): Promise<WorkspaceContext> {
  const workspaceId = optionalString(args, 'workspace_id') ?? options.defaultWorkspaceId;
  if (workspaceId === undefined) {
    throw new McpToolError({
      code: 'workspace_required',
      message: 'workspace_id is required; configure SPIDERBYTE_MCP_WORKSPACE_ID or pass it explicitly',
    });
  }
  const workspace = await options.core.accessor.get(IWorkspaceService).get(workspaceId);
  if (workspace === undefined) throw notFound('workspace', workspaceId);
  const handle = await options.core.accessor.get(IWorkspaceLifecycleService).handlerFor({
    workspaceId,
  });
  return { id: workspace.id, root: workspace.root, handle };
}

const MCP_TOOL_CAPABILITIES: Readonly<Record<string, PlatformCapability>> = {
  spiderbyte_list_sessions: 'workspace.read',
  spiderbyte_create_session: 'run.execute',
  spiderbyte_close_session: 'run.execute',

  spiderbyte_list_datasets: 'data.read',
  spiderbyte_get_dataset: 'data.read',
  spiderbyte_register_dataset: 'data.write',
  spiderbyte_profile_dataset: 'data.write',
  spiderbyte_query_dataset: 'data.read',
  spiderbyte_transform_dataset: 'data.write',

  spiderbyte_list_artifacts: 'data.read',
  spiderbyte_get_artifact: 'data.read',
  spiderbyte_get_artifact_lineage: 'data.read',
  spiderbyte_get_artifact_content: 'data.read',

  spiderbyte_list_runs: 'data.read',
  spiderbyte_get_run: 'data.read',
  spiderbyte_create_run: 'run.execute',
  spiderbyte_transition_run: 'run.execute',
  spiderbyte_cancel_run: 'run.execute',
  spiderbyte_resume_run: 'run.execute',
  spiderbyte_retry_run: 'run.execute',
  spiderbyte_rerun_run: 'run.execute',
  spiderbyte_compare_runs: 'data.read',

  spiderbyte_analyze_dataset: 'data.write',
  spiderbyte_list_analyses: 'data.read',
  spiderbyte_get_analysis: 'data.read',
  spiderbyte_list_experiments: 'data.read',
  spiderbyte_get_experiment: 'data.read',
  spiderbyte_create_experiment: 'data.write',
  spiderbyte_list_training_runs: 'data.read',
  spiderbyte_get_training_run: 'data.read',
  spiderbyte_start_training: 'execution.execute',
  spiderbyte_train_baseline_model: 'execution.execute',
  spiderbyte_cancel_training: 'execution.execute',
  spiderbyte_list_evaluations: 'data.read',
  spiderbyte_get_evaluation: 'data.read',
  spiderbyte_compare_experiments: 'data.write',
  spiderbyte_list_models: 'data.read',
  spiderbyte_get_model: 'data.read',
  spiderbyte_register_model: 'data.write',
  spiderbyte_stage_model: 'data.write',

  spiderbyte_list_provider_connections: 'connection.read',
  spiderbyte_get_provider_connection: 'connection.read',
  spiderbyte_list_execution_targets: 'workspace.read',
  spiderbyte_get_execution_target: 'workspace.read',

  spiderbyte_list_policies: 'workspace.read',
  spiderbyte_explain_policy: 'workspace.read',
  // Evaluating a request is not granting it. A workspace reader may ask the
  // policy engine whether an action needs approval; only approve/deny below
  // requires the approver capability.
  spiderbyte_request_approval: 'workspace.read',
  spiderbyte_approve_approval: 'approval.grant',
  spiderbyte_deny_approval: 'approval.grant',
  spiderbyte_get_budget_status: 'usage.read',
  spiderbyte_get_usage: 'usage.read',
  spiderbyte_list_events: 'audit.read',

  search: 'data.read',
  fetch: 'data.read',
};

function mcpCapabilityForTool(name: string): PlatformCapability {
  // Keep this allow-list explicit. A newly added workspace tool must not be
  // allowed to execute under a guessed read capability; it needs an explicit
  // authorization contract before it is exposed.
  const capability = MCP_TOOL_CAPABILITIES[name];
  if (capability === undefined) {
    throw new McpToolError({
      code: 'tool_authorization_unconfigured',
      message: `MCP authorization is not configured for tool ${name}`,
    });
  }
  return capability;
}

async function withSession<T>(
  core: Scope,
  workspaceId: string,
  sessionId: string,
  operation: (session: ISessionScopeHandle) => Promise<T>,
): Promise<T> {
  const summary = await core.accessor.get(ISessionIndex).get(sessionId);
  if (summary === undefined) throw notFound('session', sessionId);
  if (summary.workspaceId !== workspaceId) {
    throw new McpToolError({ code: 'workspace_scope_violation', message: 'session is outside the requested workspace' });
  }
  const live = getLiveSessionById(core.accessor, sessionId);
  const session = live ?? await resumeSessionById(core.accessor, sessionId);
  if (session === undefined) throw notFound('session', sessionId);
  try {
    return await operation(session);
  } finally {
    if (live === undefined) await closeSessionById(core.accessor, sessionId).catch(() => undefined);
  }
}

async function assertSessionWorkspace(core: Scope, workspaceId: string, sessionId: string): Promise<void> {
  const summary = await core.accessor.get(ISessionIndex).get(sessionId);
  if (summary === undefined) throw notFound('session', sessionId);
  if (summary.workspaceId !== workspaceId) {
    throw new McpToolError({ code: 'workspace_scope_violation', message: 'session is outside the requested workspace' });
  }
}

async function listWorkspaceRuns(
  core: Scope,
  workspaceId: string,
  sessionId: string | undefined,
  limit: number,
): Promise<readonly Run[]> {
  if (sessionId !== undefined) {
    return withSession(core, workspaceId, sessionId, (session) => session.accessor.get(ISessionRunService).list());
  }
  const summaries = await core.accessor.get(ISessionIndex).listRecent({
    workspaceIds: [workspaceId],
    limit: Math.min(Math.max(limit, 1), 100),
    includeArchived: true,
  });
  const result: Run[] = [];
  for (const summary of summaries.items) {
    const runs = await withSession(core, workspaceId, summary.id, (session) => session.accessor.get(ISessionRunService).list());
    result.push(...runs);
    if (result.length >= limit) break;
  }
  return result.slice(0, limit);
}

async function searchWorkspace(
  core: Scope,
  workspace: WorkspaceContext,
  query: string,
  limit: number,
): Promise<readonly Record<string, unknown>[]> {
  const needle = query.toLocaleLowerCase();
  const records: Record<string, unknown>[] = [];
  const add = (kind: string, id: string, title: string, summary: unknown): void => {
    if (`${title} ${JSON.stringify(summary)}`.toLocaleLowerCase().includes(needle)) {
      records.push({
        id: resourceUri(workspace.id, kind, id),
        type: kind,
        title,
        summary: redact(summary),
      });
    }
  };
  const datasets = await workspace.handle.accessor.get(IWorkspaceDatasetService).list();
  for (const item of datasets) add('dataset', item.id, item.name, item);
  const experiments = await workspace.handle.accessor.get(IWorkspaceMlService).listExperiments();
  for (const item of experiments) add('experiment', item.id, item.name, item);
  const artifacts = await workspace.handle.accessor.get(IWorkspaceArtifactService).list();
  for (const item of artifacts) add('artifact', item.id, item.name, item);
  const models = await workspace.handle.accessor.get(IWorkspaceMlService).listModels();
  for (const item of models) add('model', item.id, `${item.model_name} v${item.version}`, item);
  const sessions = await core.accessor.get(IWorkspaceSessions).listRecent(workspace.id);
  for (const item of sessions) add('session', item.id, item.title ?? item.id, item);
  return records.slice(0, Math.min(Math.max(limit, 1), 50));
}

async function fetchWorkspace(core: Scope, workspace: WorkspaceContext, id: string): Promise<unknown> {
  const parsed = parseResourceUri(id, workspace.id);
  if (parsed.kind === 'dataset') {
    const value = await workspace.handle.accessor.get(IWorkspaceDatasetService).get(parsed.resourceId);
    if (value === undefined) throw notFound('dataset', parsed.resourceId);
    return redact(value);
  }
  if (parsed.kind === 'artifact') {
    const value = await workspace.handle.accessor.get(IWorkspaceArtifactService).get(parsed.resourceId);
    if (value === undefined) throw notFound('artifact', parsed.resourceId);
    return redact(value);
  }
  if (parsed.kind === 'experiment') {
    const value = await workspace.handle.accessor.get(IWorkspaceMlService).getExperiment(parsed.resourceId);
    if (value === undefined) throw notFound('experiment', parsed.resourceId);
    return redact(value);
  }
  if (parsed.kind === 'model') {
    const value = await workspace.handle.accessor.get(IWorkspaceMlService).getModel(parsed.resourceId);
    if (value === undefined) throw notFound('model', parsed.resourceId);
    return redact(value);
  }
  if (parsed.kind === 'session') {
    const value = await core.accessor.get(ISessionIndex).get(parsed.resourceId);
    if (value === undefined) throw notFound('session', parsed.resourceId);
    if (value.workspaceId !== workspace.id) {
      throw new McpToolError({ code: 'workspace_scope_violation', message: 'session is outside the requested workspace' });
    }
    return redact(value);
  }
  throw invalid(`unsupported fetch resource type: ${parsed.kind}`);
}

function parseResourceUri(value: string, workspaceId: string): { kind: string; resourceId: string } {
  if (!value.startsWith('spiderbyte://')) throw invalid('fetch id must be a spiderbyte:// resource URI');
  const url = new URL(value);
  const [rawWorkspace, rawKind, rawResourceId] = url.pathname.split('/').filter(Boolean);
  const uriWorkspace = rawWorkspace === undefined ? undefined : decodeURIComponent(rawWorkspace);
  const kind = rawKind === undefined ? undefined : decodeURIComponent(rawKind);
  const resourceId = rawResourceId === undefined ? undefined : decodeURIComponent(rawResourceId);
  if (url.hostname !== 'workspace' || uriWorkspace !== workspaceId || kind === undefined || resourceId === undefined) {
    throw new McpToolError({ code: 'workspace_scope_violation', message: 'fetch resource is outside the requested workspace' });
  }
  return { kind, resourceId };
}

function resourceUri(workspaceId: string, kind: string, id: string): string {
  return `spiderbyte://workspace/${encodeURIComponent(workspaceId)}/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`;
}

function capability(name: string, status: z.infer<typeof capabilityStatusSchema>, message: string): Record<string, unknown> {
  return { name, status, implemented: status === 'implemented' || status === 'local-only', message };
}

function capabilityReport(options: SpyderbyteMcpOptions): Record<string, unknown> {
  return {
    product: 'SpiderByte',
    plugin: 'Otis',
    mcp_server: SPIDERBYTE_MCP_SERVER_NAME,
    mcp_protocol_version: SPIDERBYTE_MCP_PROTOCOL_VERSION,
    mcp_profile: options.profile ?? 'full',
    curated_tools: options.profile === 'curated' ? [...SPIDERBYTE_MCP_CURATED_TOOLS] : undefined,
    transports: ['stdio', 'streamable-http'],
    mode: options.mode,
    supported_clients: ['Codex CLI', 'Codex IDE extension', 'ChatGPT MCP-compatible surfaces', 'future MCP-compatible clients'],
    capabilities: [
      capability('local_workspaces', 'local-only', 'Implemented through the local workspace catalog.'),
      capability('local_sessions_and_runs', 'local-only', 'Implemented through durable local session and Run services.'),
      capability('datasets_and_artifacts', 'local-only', 'Implemented for bounded CSV/JSONL data and content-addressed artifacts.'),
      capability('ml_experiments', 'local-only', 'Implemented for local and explicitly registered customer-managed execution targets.'),
      capability('local_governance', 'local-only', 'Implemented through local policy, approval, budget, usage, and event services.'),
      capability('provider_byok', 'credential-required', 'Supported when the operator configures a local or BYOK provider connection.'),
      capability('provider_oauth', 'provider-unavailable', 'Provider-specific OAuth adapters are not implemented in Open Core.'),
      capability('mcp_oauth', 'hosted-required', 'Public MCP OAuth resource metadata, authorization-server integration, scope issuance, token validation, and PKCE are not supplied by this local daemon.'),
      capability('hosted_compute', 'hosted-required', 'No hosted worker, managed machine, or provider orchestration service ships here.'),
      capability('hosted_identity_and_tenancy', 'hosted-required', 'No hosted SpiderByte account or tenant authority ships here.'),
      capability('billing_and_entitlements', 'hosted-required', 'No billing, invoice, plan, or commercial usage ledger ships here.'),
      capability('enterprise_controls', 'enterprise-only', 'SSO/SCIM, private networking, residency, retention, and enterprise administration are outside this checkout.'),
      capability('chatgpt_ui', 'planned', 'No MCP Apps UI resource is registered; all core operations are headless.'),
    ],
  };
}

function unavailableMessage(capabilityName: string): string {
  if (capabilityName === 'provider_oauth') return 'Provider-specific OAuth adapters are unavailable; configure an explicit local/BYOK connection through SpiderByte CLI or the provider-neutral API.';
  if (capabilityName === 'hosted_identity' || capabilityName === 'billing' || capabilityName === 'team_membership') return 'Hosted identity, tenancy, team membership, billing, and entitlements require the commercial hosted control plane, which is not included or configured.';
  if (capabilityName === 'sso_scim' || capabilityName === 'enterprise_audit_retention') return 'This is an enterprise-only control and has no Open Core implementation.';
  return 'Hosted compute and managed machine operations require an authenticated commercial workspace, entitlement, budget, provider, and hosted worker service. None is configured in this local Open Core server.';
}

function localAlternative(capabilityName: string): string {
  if (capabilityName === 'provider_oauth') return 'Use `spyderbyte provider` or the local provider-connection route with an opaque SecretRef/BYOK configuration.';
  if (capabilityName === 'hosted_identity' || capabilityName === 'billing' || capabilityName === 'team_membership') return 'Use local workspaces, local organizations, local projects, and local usage/budget records.';
  return 'Use a local execution target or an explicitly registered customer-managed target, then inspect its policy and budget state before starting work.';
}

function operationValue(
  data: unknown,
  meta?: Record<string, unknown>,
  capabilityStatus?: z.infer<typeof capabilityStatusSchema>,
): OperationValue {
  return { __mcp_operation_value: true, data, meta, capabilityStatus };
}

function isOperationValue(value: unknown): value is OperationValue {
  return typeof value === 'object' && value !== null && (value as { __mcp_operation_value?: unknown }).__mcp_operation_value === true;
}

function successResult(
  requestId: string,
  data: unknown,
  meta?: Record<string, unknown>,
  workspaceId?: string,
  capabilityStatus: z.infer<typeof capabilityStatusSchema> = 'local-only',
): CallToolResult {
  const content = boundedJson(data);
  return {
    content: [{ type: 'text', text: content }],
    structuredContent: {
      request_id: requestId,
      status: 'ok',
      capability_status: capabilityStatus,
      ...(workspaceId === undefined ? {} : { workspace_id: workspaceId }),
      data: redact(data),
    },
    ...(meta === undefined ? {} : { _meta: redact(meta) as Record<string, unknown> }),
  };
}

function boundCuratedResult(result: CallToolResult): CallToolResult {
  const structured = result.structuredContent;
  if (structured === undefined || typeof structured !== 'object' || structured === null) return result;
  const data = (structured as Record<string, unknown>)['data'];
  let encoded: string;
  try {
    encoded = JSON.stringify(data) ?? '';
  } catch {
    encoded = '';
  }
  if (encoded.length <= SPIDERBYTE_MCP_MAX_CURATED_STRUCTURED_BYTES) return result;
  return {
    ...result,
    structuredContent: {
      ...(structured as Record<string, unknown>),
      data: {
        truncated: true,
        max_bytes: SPIDERBYTE_MCP_MAX_CURATED_STRUCTURED_BYTES,
        summary: boundedJson(data),
      },
    },
  };
}

function errorResult(requestId: string, error: unknown): CallToolResult {
  const mapped = safeError(error);
  return {
    isError: true,
    content: [{ type: 'text', text: `${mapped.code}: ${mapped.message}` }],
    structuredContent: {
      request_id: requestId,
      status: 'error',
      capability_status: mapped.code === 'capability_unavailable' ? 'hosted-required' : 'local-only',
      data: null,
      error: mapped,
    },
  };
}

function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof McpToolError) return { code: error.code, message: error.message };
  if (error instanceof z.ZodError) return { code: 'invalid_input', message: 'input failed SpiderByte validation' };
  if (error instanceof Error) {
    const message = error.message
      .replaceAll(/(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|secret|password)[^\s,;]*/gi, '[redacted]')
      .slice(0, 1_000);
    return { code: 'operation_failed', message: message || 'operation failed' };
  }
  return { code: 'operation_failed', message: 'operation failed' };
}

function boundedJson(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(redact(value));
  } catch {
    text = 'SpiderByte returned a non-serializable result.';
  }
  if (text.length <= SPIDERBYTE_MCP_MAX_RESULT_TEXT) return text;
  return `${text.slice(0, SPIDERBYTE_MCP_MAX_RESULT_TEXT)}… [truncated; use structured data or a bounded fetch]`;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[redacted-depth]';
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value === null || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (/secret|token|password|api[_-]?key|authorization|credential/i.test(key)) continue;
    result[key] = redact(child, depth + 1);
  }
  return result;
}

function requestIdFor(args: Record<string, unknown>, prefix: string, mcpRequestId?: string | number): string {
  const requested = optionalString(args, 'idempotency_key');
  if (requested !== undefined) return requested;
  if (mcpRequestId !== undefined) return `mcp_${String(mcpRequestId)}`;
  return `mcp_${prefix}_${ulid()}`;
}

function childRequestId(requestId: string, suffix: string): string {
  const suffixValue = `:${suffix}`;
  return `${requestId.slice(0, 256 - suffixValue.length)}${suffixValue}`;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) throw invalid(`${key} is required`);
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalObject(args: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid(`${key} must be an object`);
  return value as Record<string, unknown>;
}

function optionalArray(args: Record<string, unknown>, key: string): unknown[] | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw invalid(`${key} must be an array`);
  return value;
}

function requireStringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw invalid(`${key} must be a non-empty string array`);
  }
  return value as string[];
}

function optionalStringArray(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  return requireStringArray(args, key);
}

function optionalNumberMap(args: Record<string, unknown>, key: string): Record<string, number> | undefined {
  const value = optionalObject(args, key);
  if (value === undefined) return undefined;
  for (const [name, metric] of Object.entries(value)) {
    if (typeof metric !== 'number' || !Number.isFinite(metric)) throw invalid(`${key}.${name} must be a finite number`);
  }
  return value as Record<string, number>;
}

function requireConfirmation(args: Record<string, unknown>): void {
  if (args['confirmed'] !== true) {
    throw new McpToolError({
      code: 'confirmation_required',
      message: 'explicit confirmed=true is required for this destructive or compute-consuming action',
    });
  }
}

function resolveWorkspacePath(root: string, requested: string | undefined): string {
  const candidate = requested === undefined ? root : isAbsolute(requested) ? resolve(requested) : resolve(root, requested);
  const rel = relative(root, candidate);
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new McpToolError({ code: 'path_outside_workspace', message: 'path must remain inside the selected workspace' });
  }
  return candidate;
}

function invalid(message: string): McpToolError {
  return new McpToolError({ code: 'invalid_input', message });
}

function notFound(kind: string, id: string): McpToolError {
  return new McpToolError({ code: 'not_found', message: `${kind} not found: ${id}` });
}

async function withDeadline<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted === true) throw new McpToolError({ code: 'cancelled', message: 'MCP request was cancelled' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const cancellation = new Promise<never>((_, reject) => {
    onAbort = () => {
      reject(new McpToolError({ code: 'cancelled', message: 'MCP request was cancelled' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      reject(new McpToolError({ code: 'timeout', message: 'MCP operation exceeded the local timeout' }));
    }, SPIDERBYTE_MCP_DEFAULT_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, cancellation]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (signal !== undefined && onAbort !== undefined) signal.removeEventListener('abort', onAbort);
  }
}
