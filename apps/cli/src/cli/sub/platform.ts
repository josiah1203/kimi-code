/** SpiderByte organization, project, and workspace administration commands. */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  createSpiderByteHarness,
  resolveSpiderByteHome,
  type ExecutionTargetAuthenticationMethod,
  type ExecutionTargetCreateInput,
  type ExecutionTargetLocality,
  type ExecutionTargetSshConfig,
  type ExecutionTarget,
  type ExecutionTargetType,
  type SpiderByteHarness,
} from '@spiderbyte/sdk';
import type { Command } from 'commander';

import { createSpiderByteHostIdentity } from '#/cli/version';

interface WritableLike {
  write(chunk: string): boolean;
}

interface PlatformCommandDeps {
  readonly stdout: WritableLike;
  readonly stderr: WritableLike;
  readonly version: string;
}

interface ExecutionTargetListOptions {
  readonly workspace?: string;
  readonly json?: boolean;
}

interface ExecutionTargetAddOptions extends ExecutionTargetListOptions {
  readonly name: string;
  readonly type: string;
  readonly endpoint?: string;
  readonly locality?: string;
  readonly region?: string;
  readonly capabilities?: string;
  readonly models?: string;
  readonly providers?: string;
  readonly authMethod?: string;
  readonly credentialRef?: string;
  readonly sshHost?: string;
  readonly sshPort?: number;
  readonly sshUser?: string;
  readonly sshHostKey?: string;
  readonly sshHostHash?: 'sha256' | 'sha512' | 'md5';
  readonly sshRoot?: string;
  readonly sshAgentSocket?: string;
  readonly sshConnectionTimeout?: number;
  readonly sshCommandTimeout?: number;
}

interface PlatformSelection {
  readonly organization_id?: string;
  readonly project_id?: string;
  readonly workspace_id?: string;
}

const selectionPath = join(resolveSpiderByteHome(), 'platform-selection.json');

export function registerPlatformCommands(parent: Command, version: string): void {
  const connections = parent
    .command('connections')
    .description('Manage workspace-scoped local and customer-owned execution targets.');
  connections
    .option('--workspace <workspace-id>', 'Workspace id; defaults to the selected or current Workspace.')
    .option('--json', 'Print machine-readable JSON.')
    .action(async (options: ExecutionTargetListOptions) => {
      await listExecutionTargets(version, options);
    });

  connections
    .command('list')
    .description('List configured execution targets.')
    .option('--workspace <workspace-id>', 'Workspace id; defaults to the selected or current Workspace.')
    .option('--json', 'Print machine-readable JSON.')
    .action(async (options: ExecutionTargetListOptions) => {
      await listExecutionTargets(version, options);
    });

  connections
    .command('add')
    .description('Register a workspace-scoped execution target without accepting raw credentials.')
    .requiredOption('--name <name>')
    .requiredOption('--type <type>', 'local, ssh, docker, kubernetes, customer-managed, or private-gateway')
    .option('--endpoint <endpoint>', 'Endpoint reference; embedded credentials and credential query parameters are rejected.')
    .option('--workspace <workspace-id>', 'Workspace id; defaults to the selected or current Workspace.')
    .option('--locality <locality>', 'local, customer-region, provider-region, or unknown')
    .option('--region <region>')
    .option('--capabilities <items>', 'Comma-separated advertised operations or capabilities.')
    .option('--models <items>', 'Comma-separated available model identifiers.')
    .option('--providers <items>', 'Comma-separated available provider identifiers.')
    .option('--auth-method <method>', 'none, secret_ref, ssh_key, ssh_agent, bearer, mtls, workload_identity, or unknown')
    .option('--credential-ref <secret-ref>', 'Opaque secret_<reference> only; secret material is never accepted.')
    .option('--ssh-host <host>', 'Explicit SSH host; required for --type ssh.')
    .option('--ssh-port <port>', 'SSH port.', parsePositiveInteger)
    .option('--ssh-user <user>', 'SSH username; required for --type ssh.')
    .option('--ssh-host-key <fingerprint>', 'Expected hexadecimal SSH host-key fingerprint; required for --type ssh.')
    .option('--ssh-host-hash <algorithm>', 'SSH host-key fingerprint algorithm.', 'sha256')
    .option('--ssh-root <path>', 'Confined absolute remote workspace root; required for --type ssh.')
    .option('--ssh-agent-socket <path>', 'Explicit SSH agent socket for ssh_agent authentication.')
    .option('--ssh-connection-timeout <milliseconds>', 'SSH connection timeout.', parsePositiveInteger)
    .option('--ssh-command-timeout <milliseconds>', 'Remote daemon command timeout.', parsePositiveInteger)
    .option('--json', 'Print machine-readable JSON.')
    .action(async (options: ExecutionTargetAddOptions) => {
      await runPlatformCommand({ stdout: process.stdout, stderr: process.stderr, version }, async (platform) => {
        const workspaceId = await resolveWorkspaceId(platform, options.workspace);
        const type = options.type as ExecutionTargetType;
        if (type === 'ssh') {
          if (options.sshHost === undefined || options.sshUser === undefined || options.sshHostKey === undefined || options.sshRoot === undefined) {
            throw new Error('--type ssh requires --ssh-host, --ssh-user, --ssh-host-key, and --ssh-root');
          }
          if (!['sha256', 'sha512', 'md5'].includes(options.sshHostHash ?? 'sha256')) {
            throw new Error('--ssh-host-hash must be sha256, sha512, or md5');
          }
        }
        const ssh: ExecutionTargetSshConfig | undefined = type === 'ssh'
          ? {
            host: options.sshHost!,
            port: options.sshPort ?? 22,
            user: options.sshUser!,
            host_key_hash: options.sshHostHash ?? 'sha256',
            host_key_fingerprint: options.sshHostKey!,
            remote_root: options.sshRoot!,
            agent_socket: options.sshAgentSocket,
            connection_timeout_ms: options.sshConnectionTimeout ?? 10_000,
            command_timeout_ms: options.sshCommandTimeout ?? 300_000,
          }
          : undefined;
        const input: ExecutionTargetCreateInput = {
          request_id: requestId('connection_add'),
          name: options.name,
          type,
          locality: (options.locality ?? (type === 'local' ? 'local' : 'customer-region')) as ExecutionTargetLocality,
          region: options.region,
          endpoint: options.endpoint,
          capabilities: parseList(options.capabilities),
          available_models: parseList(options.models),
          available_providers: parseList(options.providers),
          authentication_method: options.authMethod as ExecutionTargetAuthenticationMethod | undefined,
          credential_ref: options.credentialRef,
          ssh,
        };
        const target = await platform.executionTargets.register(workspaceId, input);
        writeRows(process.stdout, options.json === true, [target], formatExecutionTarget);
      });
    });

  connections
    .command('inspect')
    .description('Inspect one execution target without resolving credentials.')
    .requiredOption('--id <target-id>')
    .option('--workspace <workspace-id>', 'Workspace id; defaults to the selected or current Workspace.')
    .option('--json', 'Print machine-readable JSON.')
    .action(async (options: { readonly id: string } & ExecutionTargetListOptions) => {
      await runPlatformCommand({ stdout: process.stdout, stderr: process.stderr, version }, async (platform) => {
        const workspaceId = await resolveWorkspaceId(platform, options.workspace);
        const target = await platform.executionTargets.get(workspaceId, options.id);
        if (target === undefined) throw new Error(`execution target not found: ${options.id}`);
        writeRows(process.stdout, options.json === true, [target], formatExecutionTarget);
      });
    });

  connections
    .command('test')
    .description('Run a bounded health and capability check against one execution target.')
    .requiredOption('--id <target-id>')
    .option('--workspace <workspace-id>', 'Workspace id; defaults to the selected or current Workspace.')
    .option('--timeout <milliseconds>', 'Health-check timeout.', parsePositiveInteger, 5_000)
    .option('--json', 'Print machine-readable JSON.')
    .action(async (options: { readonly id: string; readonly timeout: number } & ExecutionTargetListOptions) => {
      await runPlatformCommand({ stdout: process.stdout, stderr: process.stderr, version }, async (platform) => {
        const workspaceId = await resolveWorkspaceId(platform, options.workspace);
        const result = await platform.executionTargets.test(workspaceId, options.id, {
          request_id: requestId('connection_test'),
          timeout_ms: options.timeout,
        });
        writeRows(process.stdout, options.json === true, [result], (item) =>
          `${item.target_id}\t${item.status}\t${item.message ?? ''}`,
        );
      });
    });

  connections
    .command('ready')
    .description('Mark a target ready after its health and compatibility check has passed.')
    .requiredOption('--id <target-id>')
    .option('--workspace <workspace-id>', 'Workspace id; defaults to the selected or current Workspace.')
    .option('--json', 'Print machine-readable JSON.')
    .action(async (options: { readonly id: string } & ExecutionTargetListOptions) => {
      await runPlatformCommand({ stdout: process.stdout, stderr: process.stderr, version }, async (platform) => {
        const workspaceId = await resolveWorkspaceId(platform, options.workspace);
        const target = await platform.executionTargets.markReady(workspaceId, options.id, {
          request_id: requestId('connection_ready'),
        });
        if (target === undefined) throw new Error(`execution target not found: ${options.id}`);
        writeRows(process.stdout, options.json === true, [target], formatExecutionTarget);
      });
    });

  connections
    .command('remove')
    .description('Revoke an execution target; the durable record remains for audit history.')
    .requiredOption('--id <target-id>')
    .option('--workspace <workspace-id>', 'Workspace id; defaults to the selected or current Workspace.')
    .option('--json', 'Print machine-readable JSON.')
    .action(async (options: { readonly id: string } & ExecutionTargetListOptions) => {
      await runPlatformCommand({ stdout: process.stdout, stderr: process.stderr, version }, async (platform) => {
        const workspaceId = await resolveWorkspaceId(platform, options.workspace);
        const target = await platform.executionTargets.revoke(workspaceId, options.id, {
          request_id: requestId('connection_remove'),
        });
        if (target === undefined) throw new Error(`execution target not found: ${options.id}`);
        writeRows(process.stdout, options.json === true, [target], formatExecutionTarget);
      });
    });

  const usage = parent
    .command('usage')
    .description('Show local SpiderByte Workspace usage.');
  usage
    .option('--workspace <workspace-id>', 'Workspace id; defaults to the selected or current Workspace.')
    .option('--json', 'Print machine-readable JSON.')
    .action(async (options: { readonly workspace?: string; readonly json?: boolean }) => {
      await runPlatformCommand({ stdout: process.stdout, stderr: process.stderr, version }, async (platform) => {
        const workspaceId = await resolveWorkspaceId(platform, options.workspace);
        const summary = await platform.usage.usageSummary(workspaceId);
        writeRows(process.stdout, options.json === true, [summary], (item) =>
          `workspace=${item.workspace_id}\trecords=${item.record_count}\tintelligence_percent=${item.intelligence_percent}\tartifact_storage_units=${item.artifact_storage_units}\tplugin_usage_units=${item.plugin_usage_units}`,
        );
      });
    });

  const plugins = parent
    .command('plugins')
    .description('List installed SpiderByte plugins through the local harness.');
  plugins
    .option('--project <project-id>', 'Project id; defaults to the selected Project.')
    .option('--json', 'Print machine-readable JSON.')
    .action(async (options: { readonly project?: string; readonly json?: boolean }) => {
      await runPlatformCommand({ stdout: process.stdout, stderr: process.stderr, version }, async (platform, harness) => {
        const selection = await readSelection();
        const projectId = options.project ?? selection.project_id;
        if (projectId !== undefined) {
          const rows = await platform.plugins.list(projectId);
          writeRows(process.stdout, options.json === true, rows, (item) =>
            `${item.id}\t${item.manifest.name}\t${item.manifest.provider_type}\t${item.state}`,
          );
          return;
        }
        const rows = await harness.listPlugins();
        writeRows(process.stdout, options.json === true, rows, (item) =>
          `${item.id}\t${item.displayName}\t${item.enabled ? 'enabled' : 'disabled'}\t${item.state}`,
        );
      });
    });

  const organization = parent
    .command('organization')
    .description('Manage SpiderByte Organizations in the canonical platform control plane.');
  organization
    .command('list')
    .option('--json', 'Print machine-readable JSON.')
    .action(async (options: { readonly json?: boolean }) => {
      await runPlatformCommand({ stdout: process.stdout, stderr: process.stderr, version }, async (platform) => {
        const organizations = await platform.governance.listOrganizations();
        writeRows(process.stdout, options.json === true, organizations, (item) =>
          `${item.id}\t${item.name}\t${item.mode}`,
        );
      });
    });
  organization
    .command('create')
    .requiredOption('--name <name>')
    .option('--mode <mode>', 'Organization mode (only local is supported).', 'local')
    .option('--actor <id>', 'Local actor identity.', 'local-user')
    .action(async (options: { readonly name: string; readonly mode: string; readonly actor: string }) => {
      await runPlatformCommand({ stdout: process.stdout, stderr: process.stderr, version }, async (platform) => {
        if (options.mode !== 'local') {
          throw new Error(`unsupported organization mode '${options.mode}'`);
        }
        const organization = await platform.governance.createOrganization({
          request_id: `cli_organization_create_${Date.now().toString(36)}`,
          actor_id: options.actor,
          name: options.name,
          mode: options.mode,
        });
        process.stdout.write(`${organization.id}\t${organization.name}\t${organization.mode}\n`);
      });
    });
  organization
    .command('use')
    .argument('<organization-id>')
    .action(async (organizationId: string) => {
      await runPlatformCommand({ stdout: process.stdout, stderr: process.stderr, version }, async (platform) => {
        const organization = await platform.governance.getOrganization(organizationId);
        if (organization === undefined) throw new Error(`organization not found: ${organizationId}`);
        const current = await readSelection();
        await writeSelection({ ...current, organization_id: organization.id, project_id: undefined });
        process.stdout.write(`Using organization ${organization.id} (${organization.name}).\n`);
      });
    });

  const project = parent
    .command('project')
    .description('Manage SpiderByte Projects in the canonical platform control plane.');
  project
    .command('list')
    .option('--organization <organization-id>')
    .option('--json', 'Print machine-readable JSON.')
    .action(async (options: { readonly organization?: string; readonly json?: boolean }) => {
      await runPlatformCommand({ stdout: process.stdout, stderr: process.stderr, version }, async (platform) => {
        const selection = await readSelection();
        const projects = await platform.governance.listProjects(options.organization ?? selection.organization_id);
        writeRows(process.stdout, options.json === true, projects, (item) =>
          `${item.id}\t${item.organization_id}\t${item.name}\t${item.state}`,
        );
      });
    });
  project
    .command('create')
    .requiredOption('--organization <organization-id>')
    .requiredOption('--name <name>')
    .option('--actor <id>', 'Local actor identity.', 'local-user')
    .action(async (options: { readonly organization: string; readonly name: string; readonly actor: string }) => {
      await runPlatformCommand({ stdout: process.stdout, stderr: process.stderr, version }, async (platform) => {
        const project = await platform.governance.createProject({
          request_id: `cli_project_create_${Date.now().toString(36)}`,
          actor_id: options.actor,
          organization_id: options.organization,
          name: options.name,
        });
        process.stdout.write(`${project.id}\t${project.organization_id}\t${project.name}\n`);
      });
    });
  project
    .command('use')
    .argument('<project-id>')
    .action(async (projectId: string) => {
      await runPlatformCommand({ stdout: process.stdout, stderr: process.stderr, version }, async (platform) => {
        const project = await platform.governance.getProject(projectId);
        if (project === undefined) throw new Error(`project not found: ${projectId}`);
        const current = await readSelection();
        await writeSelection({ ...current, organization_id: project.organization_id, project_id: project.id });
        process.stdout.write(`Using project ${project.id} (${project.name}).\n`);
      });
    });

  const workspace = parent
    .command('workspace')
    .description('Manage SpiderByte Workspaces in the canonical platform control plane.');
  workspace
    .command('list')
    .option('--json', 'Print machine-readable JSON.')
    .action(async (options: { readonly json?: boolean }) => {
      await runPlatformCommand({ stdout: process.stdout, stderr: process.stderr, version }, async (platform) => {
        const workspaces = await platform.workspaces.list();
        writeRows(process.stdout, options.json === true, workspaces, (item) =>
          `${item.id}\t${item.name}\t${item.root}`,
        );
      });
    });
  workspace
    .command('use')
    .argument('<workspace-id>')
    .action(async (workspaceId: string) => {
      await runPlatformCommand({ stdout: process.stdout, stderr: process.stderr, version }, async (platform) => {
        const workspace = await platform.workspaces.get(workspaceId);
        if (workspace === undefined) throw new Error(`workspace not found: ${workspaceId}`);
        const current = await readSelection();
        await writeSelection({ ...current, workspace_id: workspace.id });
        process.stdout.write(`Using workspace ${workspace.id} (${workspace.name}).\n`);
      });
    });
}

async function runPlatformCommand<T>(
  deps: PlatformCommandDeps,
  operation: (
    platform: NonNullable<SpiderByteHarness['platform']>,
    harness: SpiderByteHarness,
  ) => Promise<T>,
): Promise<void> {
  const harness = createSpiderByteHarness({
    homeDir: resolveSpiderByteHome(),
    identity: createSpiderByteHostIdentity(deps.version),
    uiMode: 'platform-admin',
  });
  try {
    await harness.ensureConfigFile();
    if (harness.platform === undefined) {
      throw new Error('SpiderByte local platform services are unavailable; inspect the local configuration and diagnostics.');
    }
    await operation(harness.platform, harness);
  } catch (error) {
    deps.stderr.write(`SpiderByte platform command failed: ${errorMessage(error)}\n`);
    process.exitCode = 1;
  } finally {
    await harness.close();
  }
}

async function resolveWorkspaceId(
  platform: NonNullable<SpiderByteHarness['platform']>,
  explicit: string | undefined,
): Promise<string> {
  if (explicit !== undefined) {
    if (await platform.workspaces.get(explicit) === undefined) {
      throw new Error(`workspace not found: ${explicit}`);
    }
    return explicit;
  }
  const selection = await readSelection();
  if (selection.workspace_id !== undefined) return selection.workspace_id;
  const current = await platform.workspaceIdForRoot?.(process.cwd());
  if (current === undefined) throw new Error('no Workspace selected or registered for the current directory');
  return current;
}

async function readSelection(): Promise<PlatformSelection> {
  try {
    const raw = JSON.parse(await readFile(selectionPath, 'utf8')) as unknown;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const value = raw as Record<string, unknown>;
    return {
      organization_id: typeof value['organization_id'] === 'string' ? value['organization_id'] : undefined,
      project_id: typeof value['project_id'] === 'string' ? value['project_id'] : undefined,
      workspace_id: typeof value['workspace_id'] === 'string' ? value['workspace_id'] : undefined,
    };
  } catch {
    return {};
  }
}

async function writeSelection(selection: PlatformSelection): Promise<void> {
  await mkdir(dirname(selectionPath), { recursive: true });
  const temporaryPath = `${selectionPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(selection, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, selectionPath);
}

function writeRows<T>(stdout: WritableLike, json: boolean, rows: readonly T[], format: (row: T) => string): void {
  stdout.write(json ? `${JSON.stringify(rows, null, 2)}\n` : `${rows.map(format).join('\n')}${rows.length === 0 ? '' : '\n'}`);
}

async function listExecutionTargets(version: string, options: ExecutionTargetListOptions): Promise<void> {
  await runPlatformCommand({ stdout: process.stdout, stderr: process.stderr, version }, async (platform) => {
    const workspaceId = await resolveWorkspaceId(platform, options.workspace);
    const rows = await platform.executionTargets.list(workspaceId);
    writeRows(process.stdout, options.json === true, rows, formatExecutionTarget);
  });
}

function formatExecutionTarget(target: ExecutionTarget): string {
  return [
    target.id,
    target.name,
    target.type,
    target.state,
    target.health_status ?? 'unknown',
    target.endpoint ?? '',
  ].join('\t');
}

function parseList(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`expected a positive integer, got '${value}'`);
  return parsed;
}

function requestId(prefix: string): string {
  return `cli_${prefix}_${Date.now().toString(36)}_${process.pid.toString(36)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
