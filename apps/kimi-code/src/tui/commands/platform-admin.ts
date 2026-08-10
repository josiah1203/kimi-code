import type {
  Artifact,
  Automation,
  Budget,
  BudgetReservation,
  BudgetStatus,
  Dataset,
  Experiment,
  ExecutionTarget,
  ModelVersion,
  Organization,
  OrganizationMember,
  Pipeline,
  PolicyDecision,
  PolicyRule,
  Project,
  ProjectMember,
  ProviderConnection,
  WorkspaceMember,
} from '@moonshot-ai/kimi-code-sdk';

import type { SlashCommandHost } from './dispatch';

export async function handleWorkspaceCommand(host: SlashCommandHost, args = ''): Promise<void> {
  const context = await platformContext(host);
  if (context === undefined) return;
  const [members, entitlements] = await Promise.all([
    context.platform.commercial.listMembers(context.workspaceId),
    context.platform.commercial.listEntitlements(context.workspaceId),
  ]);
  const mode = args.trim().toLowerCase();
  if (mode === 'members') {
    host.showNotice('Workspace members', members.map(formatMember).join('\n') || 'No members recorded.');
    return;
  }
  if (mode === 'entitlements') {
    host.showNotice(
      'Workspace entitlements',
      entitlements
        .map((item) => `${item.key} · ${item.enabled ? 'enabled' : 'disabled'}${item.limit === undefined ? '' : ` · limit ${item.limit}`}`)
        .join('\n') || 'No entitlements recorded.',
    );
    return;
  }
  host.showNotice(
    'SpiderByte workspace',
    [
      `id: ${context.workspaceId}`,
      `root: ${host.state.appState.workDir}`,
      `members: ${String(members.length)}`,
      ...members.map(formatMember),
      `entitlements: ${String(entitlements.length)}`,
    ].join('\n'),
  );
}

export async function handleProjectCommand(host: SlashCommandHost): Promise<void> {
  const context = await platformContext(host);
  if (context === undefined) return;
  const project = await context.platform.governance.projectForWorkspace(context.workspaceId);
  if (project === undefined) {
    host.showError('The current workspace is not bound to a SpiderByte Project.');
    return;
  }
  host.showNotice('SpiderByte project', formatProject(project, context.workspaceId));
}

export async function handleOrganizationCommand(host: SlashCommandHost): Promise<void> {
  const context = await platformContext(host);
  if (context === undefined) return;
  const project = await context.platform.governance.projectForWorkspace(context.workspaceId);
  const organizations = await context.platform.governance.listOrganizations();
  const current = project === undefined
    ? undefined
    : organizations.find((organization) => organization.id === project.organization_id);
  host.showNotice(
    'SpiderByte organizations',
    organizations.map((organization) => formatOrganization(organization, organization.id === current?.id)).join('\n') || 'No organizations recorded.',
  );
}

export async function handleMembersCommand(host: SlashCommandHost): Promise<void> {
  const context = await platformContext(host);
  if (context === undefined) return;
  const [workspaceMembers, project] = await Promise.all([
    context.platform.commercial.listMembers(context.workspaceId),
    context.platform.governance.projectForWorkspace(context.workspaceId),
  ]);
  const organizationMembers = project === undefined
    ? []
    : await context.platform.governance.listOrganizationMembers(project.organization_id);
  const projectMembers = project === undefined
    ? []
    : await context.platform.governance.listProjectMembers(project.id);
  host.showNotice(
    'SpiderByte members',
    [
      'workspace:',
      ...workspaceMembers.map((member) => `  ${formatMember(member)}`),
      'organization:',
      ...organizationMembers.map((member) => `  ${formatOrganizationMember(member)}`),
      ...(project === undefined ? [] : ['project:', ...projectMembers.map((member) => `  ${formatProjectMember(member)}`)]),
    ].join('\n'),
  );
}

export async function handleConnectionsCommand(host: SlashCommandHost): Promise<void> {
  const context = await platformContext(host);
  if (context === undefined) return;
  const connections = await context.platform.connections.list(context.workspaceId);
  host.showNotice(
    'Provider connections',
    connections.map(formatConnection).join('\n') || 'No provider connections recorded.',
  );
}

export async function handleBudgetsCommand(host: SlashCommandHost): Promise<void> {
  const context = await platformContext(host);
  if (context === undefined) return;
  const status = await context.platform.budgets.status(context.workspaceId);
  host.showNotice('Budget status', formatBudgetStatus(status));
}

export async function handlePolicyCommand(host: SlashCommandHost, args = ''): Promise<void> {
  const context = await platformContext(host);
  if (context === undefined) return;
  const mode = args.trim().toLowerCase();
  if (mode === 'rules' || mode === '') {
    const rules = await context.platform.policy.rules(context.workspaceId);
    host.showNotice('Workspace policy rules', rules.map(formatRule).join('\n') || 'No policy rules recorded.');
    return;
  }
  const decisions = await context.platform.policy.list(context.workspaceId);
  const pending = decisions.filter((decision) =>
    decision.state === 'requested' || decision.outcome === 'approval_required',
  );
  host.showNotice(
    'Policy decisions',
    (pending.length > 0 ? pending : decisions).map(formatDecision).join('\n') || 'No policy decisions recorded.',
  );
}

export async function handleExecutionTargetsCommand(host: SlashCommandHost): Promise<void> {
  const context = await platformContext(host);
  if (context === undefined) return;
  const targets = await context.platform.executionTargets.list(context.workspaceId);
  host.showNotice(
    'Execution targets',
    targets.map(formatTarget).join('\n') || 'No execution targets registered.',
  );
}

export async function handleArtifactsCommand(host: SlashCommandHost, args = ''): Promise<void> {
  const context = await platformContext(host);
  if (context === undefined) return;
  const kind = args.trim();
  const artifacts = await context.platform.artifacts.list(
    context.workspaceId,
    isArtifactKind(kind) ? kind : undefined,
  );
  host.showNotice(
    kind.length > 0 && !isArtifactKind(kind) ? 'Artifacts (all kinds)' : 'Artifacts',
    artifacts.slice(0, 50).map(formatArtifact).join('\n') || 'No artifacts recorded.',
  );
}

export async function handleDatasetsCommand(host: SlashCommandHost, args = ''): Promise<void> {
  const context = await platformContext(host);
  if (context === undefined) return;
  const id = args.trim();
  const datasets = id.length > 0
    ? [await context.platform.datasets.get(context.workspaceId, id)]
    : await context.platform.datasets.list(context.workspaceId);
  host.showNotice(
    id.length > 0 ? `Dataset ${id}` : 'Datasets',
    datasets.filter((dataset): dataset is Dataset => dataset !== undefined).map(formatDataset).join('\n') || 'No datasets recorded.',
  );
}

export async function handleExperimentsCommand(host: SlashCommandHost, args = ''): Promise<void> {
  const context = await platformContext(host);
  if (context === undefined) return;
  const id = args.trim();
  const experiments = id.length > 0
    ? [await context.platform.ml.getExperiment(context.workspaceId, id)]
    : await context.platform.ml.listExperiments(context.workspaceId);
  host.showNotice(
    id.length > 0 ? `Experiment ${id}` : 'Experiments',
    experiments.filter((experiment): experiment is Experiment => experiment !== undefined).map(formatExperiment).join('\n') || 'No experiments recorded.',
  );
}

export async function handleModelsCommand(host: SlashCommandHost, args = ''): Promise<void> {
  const context = await platformContext(host);
  if (context === undefined) return;
  const id = args.trim();
  const models = id.length > 0
    ? [await context.platform.ml.getModel(context.workspaceId, id)]
    : await context.platform.ml.listModels(context.workspaceId);
  host.showNotice(
    id.length > 0 ? `Model ${id}` : 'Models',
    models.filter((model): model is ModelVersion => model !== undefined).map(formatModel).join('\n') || 'No registered models recorded.',
  );
}

export async function handlePipelinesCommand(host: SlashCommandHost, args = ''): Promise<void> {
  const context = await platformContext(host);
  if (context === undefined) return;
  const id = args.trim();
  const pipelines = id.length > 0
    ? [await context.platform.pipelines.get(context.workspaceId, id)]
    : await context.platform.pipelines.list(context.workspaceId);
  host.showNotice(
    id.length > 0 ? `Pipeline ${id}` : 'Pipelines',
    pipelines.filter((pipeline): pipeline is Pipeline => pipeline !== undefined).map(formatPipeline).join('\n') || 'No pipelines recorded.',
  );
}

export async function handleAutomationsCommand(host: SlashCommandHost, args = ''): Promise<void> {
  const context = await platformContext(host);
  if (context === undefined) return;
  const id = args.trim();
  const automations = id.length > 0
    ? [await context.platform.automations.get(context.workspaceId, id)]
    : await context.platform.automations.list(context.workspaceId);
  host.showNotice(
    id.length > 0 ? `Automation ${id}` : 'Automations',
    automations.filter((automation): automation is Automation => automation !== undefined).map(formatAutomation).join('\n') || 'No automations recorded.',
  );
}

async function platformContext(host: SlashCommandHost): Promise<{
  readonly platform: NonNullable<typeof host.harness.platform>;
  readonly workspaceId: string;
} | undefined> {
  const platform = host.harness.platform;
  if (platform?.workspaceIdForRoot === undefined) {
    host.showError(
      'Canonical platform services are unavailable. Inspect startup diagnostics or use the explicit compatibility commands.',
    );
    return undefined;
  }
  const session = host.session ?? await host.ensureSession();
  if (session === undefined) return undefined;
  const workspaceId = await platform.workspaceIdForRoot(host.state.appState.workDir);
  if (workspaceId === undefined) {
    host.showError('The current directory is not registered as a SpiderByte workspace.');
    return undefined;
  }
  return { platform, workspaceId };
}

function formatMember(member: WorkspaceMember): string {
  return `${member.member_id} · ${member.role}`;
}

function formatProject(project: Project, workspaceId: string): string {
  return [
    `id: ${project.id}`,
    `organization: ${project.organization_id}`,
    `name: ${project.name}`,
    `state: ${project.state}`,
    `workspace: ${workspaceId}`,
  ].join('\n');
}

function formatOrganization(organization: Organization, selected: boolean): string {
  return `${selected ? '* ' : ''}${organization.id} · ${organization.name} · ${organization.mode}`;
}

function formatOrganizationMember(member: OrganizationMember): string {
  return `${member.member_id} · ${member.role}`;
}

function formatProjectMember(member: ProjectMember): string {
  return `${member.member_id} · ${member.role}`;
}

function formatConnection(connection: ProviderConnection): string {
  return `${connection.id} · ${connection.provider} · ${connection.state} · secret:${connection.secret_ref}`;
}

function formatBudgetStatus(status: BudgetStatus): string {
  const budgets = status.budgets.map(formatBudget);
  const reservations = status.reservations.map(formatReservation);
  const warnings = status.warnings.length > 0 ? ['warnings:', ...status.warnings.map((warning) => `  ${warning}`)] : [];
  return [...budgets, ...reservations, ...warnings].join('\n') || 'No budgets configured.';
}

function formatBudget(budget: Budget): string {
  return `${budget.id} · ${budget.scope}:${budget.scope_id} · ${budget.meter} · ${budget.state} · ${String(budget.consumed)} consumed / ${String(budget.limit)} limit`;
}

function formatReservation(reservation: BudgetReservation): string {
  return `reservation ${reservation.id} · ${reservation.meter} · ${reservation.state} · run:${reservation.run_id}`;
}

function formatRule(rule: PolicyRule): string {
  return `${rule.effect} · ${rule.capability} · ${rule.action ?? 'all actions'}`;
}

function formatDecision(decision: PolicyDecision): string {
  return `${decision.id} · ${decision.outcome} · ${decision.state} · ${decision.reason}`;
}

function formatTarget(target: ExecutionTarget): string {
  return `${target.id} · ${target.type} · ${target.state} · capabilities: ${target.capabilities.join(', ') || 'none'}`;
}

function formatArtifact(artifact: Artifact): string {
  const hash = artifact.sha256 === undefined ? '' : ` · sha256:${artifact.sha256.slice(0, 12)}`;
  return `${artifact.id} · ${artifact.kind} · ${artifact.name}${hash}`;
}

function formatDataset(dataset: Dataset): string {
  return `${dataset.id} · ${dataset.name} · ${dataset.format} · v${String(dataset.current_version)} · ${String(dataset.versions.length)} version${dataset.versions.length === 1 ? '' : 's'}`;
}

function formatExperiment(experiment: Experiment): string {
  return `${experiment.id} · ${experiment.name} · ${experiment.task} · ${experiment.state} · dataset:${experiment.dataset_id} · ${String(experiment.training_run_ids.length)} training run${experiment.training_run_ids.length === 1 ? '' : 's'}`;
}

function formatModel(model: ModelVersion): string {
  const metrics = Object.entries(model.metrics).map(([name, value]) => `${name}=${String(value)}`).join(', ');
  return `${model.id} · ${model.model_name} v${String(model.version)} · ${model.stage}${metrics.length > 0 ? ` · ${metrics}` : ''}`;
}

function formatPipeline(pipeline: Pipeline): string {
  return `${pipeline.id} · ${pipeline.name} · ${pipeline.state} · ${String(pipeline.steps.length)} step${pipeline.steps.length === 1 ? '' : 's'} · ${String(pipeline.pipeline_run_ids.length)} run${pipeline.pipeline_run_ids.length === 1 ? '' : 's'}`;
}

function formatAutomation(automation: Automation): string {
  return `${automation.id} · ${automation.name} · ${automation.trigger} · ${automation.state} · approval:${automation.approval_required ? 'required' : 'not required'}`;
}

function isArtifactKind(value: string): value is Artifact['kind'] {
  return [
    'dataset',
    'model',
    'checkpoint',
    'metrics',
    'report',
    'visualization',
    'lineage',
    'log',
    'other',
  ].includes(value as Artifact['kind']);
}
