/** Durable project-scoped plugin catalog; runtime adapters remain separate. */

import { ulid } from 'ulid';
import { z } from 'zod';

import { Disposable } from '#/_base/di/lifecycle';
import { Emitter, type Event } from '#/_base/event';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { LifecycleScope } from '#/app/scopes';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IPlatformAuthorizationService } from '#/app/authorization/authorization';
import { IPlatformGovernanceService } from '#/app/governance/governance';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import {
  nowIsoDateTime,
  platformPluginCommandInputSchema,
  platformPluginConfigureInputSchema,
  platformPluginDiscoverInputSchema,
  platformPluginInstallInputSchema,
  platformPluginManifestSchema,
  platformPluginSchema,
  type PlatformPlugin,
  type PlatformPluginCommandInput,
  type PlatformPluginConfigureInput,
  type PlatformPluginDiscoverInput,
  type PlatformPluginInstallInput,
  type PlatformPluginManifest,
} from '@moonshot-ai/protocol';

import { PlatformPluginErrors, PlatformPluginServiceError } from './errors';
import { IPlatformPluginService, type PlatformPluginChangedEvent } from './platformPlugins';

const PLUGINS_KEY = 'spiderbyte-platform-plugins.json';
const DOCUMENT_VERSION = 1;

const documentSchema = z.strictObject({
  version: z.literal(DOCUMENT_VERSION),
  plugins: z.array(platformPluginSchema),
  requests: z.record(z.string(), z.string()).default({}),
});

type PluginDocument = z.infer<typeof documentSchema>;

export class PlatformPluginService extends Disposable implements IPlatformPluginService {
  declare readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  readonly onDidChange: Event<PlatformPluginChangedEvent>;

  private readonly changes = this._register(new Emitter<PlatformPluginChangedEvent>());
  private readonly scope: string;
  private plugins: readonly PlatformPlugin[] = [];
  private requests: Record<string, string> = {};
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    @IAtomicDocumentStore private readonly store: IAtomicDocumentStore,
    @IBootstrapService bootstrap: IBootstrapService,
    @IPlatformAuthorizationService private readonly authorization: IPlatformAuthorizationService,
    @IPlatformGovernanceService private readonly governance: IPlatformGovernanceService,
  ) {
    super();
    this.scope = `${bootstrap.scope('store')}/platform`;
    this.onDidChange = this.changes.event;
    this.ready = this.load();
  }

  async discover(input: PlatformPluginDiscoverInput): Promise<PlatformPluginManifest> {
    return platformPluginManifestSchema.parse(platformPluginDiscoverInputSchema.parse(input).manifest);
  }

  async list(projectId?: string): Promise<readonly PlatformPlugin[]> {
    await this.ready;
    return this.plugins.filter((plugin) => projectId === undefined || plugin.project_id === projectId);
  }

  async get(id: string): Promise<PlatformPlugin | undefined> {
    await this.ready;
    return this.plugins.find((plugin) => plugin.id === id);
  }

  async install(input: PlatformPluginInstallInput): Promise<PlatformPlugin> {
    const command = platformPluginInstallInputSchema.parse(input);
    return this.enqueue(async () => {
      await this.ready;
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.requirePlugin(mapped);
      await this.authorization.assert({
        request_id: command.request_id,
        actor_id: command.actor_id,
        project_id: command.project_id,
        capability: 'plugin.install',
      });
      const project = await this.governance.getProject(command.project_id);
      if (project === undefined) {
        throw new PlatformPluginServiceError(
          PlatformPluginErrors.codes.PLATFORM_PLUGIN_PROJECT_MISMATCH,
          `project not found: ${command.project_id}`,
        );
      }
      const existing = this.plugins.find((plugin) =>
        plugin.project_id === project.id &&
        plugin.manifest.id === command.manifest.id &&
        plugin.state !== 'uninstalled',
      );
      if (existing !== undefined) {
        throw new PlatformPluginServiceError(
          PlatformPluginErrors.codes.PLATFORM_PLUGIN_CONFLICT,
          `plugin is already installed in project: ${command.manifest.id}`,
          { projectId: project.id, pluginId: existing.id },
        );
      }
      const now = nowIsoDateTime();
      const plugin = platformPluginSchema.parse({
        id: `plugin_${ulid()}`,
        project_id: project.id,
        manifest: command.manifest,
        state: 'installed',
        created_at: now,
        updated_at: now,
      });
      await this.replace([...this.plugins, plugin], {
        ...this.requests,
        [command.request_id]: plugin.id,
      });
      await this.governance.bindProjectResource({
        request_id: `plugin-binding:${command.request_id}`,
        actor_id: command.actor_id,
        project_id: project.id,
        kind: 'plugin_connection',
        resource_id: plugin.id,
        role: 'execute',
      });
      this.changes.fire({ kind: 'installed', plugin });
      return plugin;
    });
  }

  async configure(input: PlatformPluginConfigureInput): Promise<PlatformPlugin> {
    const command = platformPluginConfigureInputSchema.parse(input);
    return this.enqueue(async () => {
      await this.ready;
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.requirePlugin(mapped);
      await this.authorization.assert({
        request_id: command.request_id,
        actor_id: command.actor_id,
        project_id: command.project_id,
        capability: 'connection.manage',
      });
      const current = this.requirePlugin(command.plugin_id);
      this.assertProject(current, command.project_id);
      if (current.state === 'revoked' || current.state === 'uninstalled') {
        throw new PlatformPluginServiceError(
          PlatformPluginErrors.codes.PLATFORM_PLUGIN_INVALID_STATE,
          `plugin cannot be configured from state: ${current.state}`,
        );
      }
      const plugin = platformPluginSchema.parse({
        ...current,
        connection_id: command.connection_id,
        state: 'configured',
        updated_at: nowIsoDateTime(),
      });
      await this.replace(
        this.plugins.map((candidate) => candidate.id === plugin.id ? plugin : candidate),
        { ...this.requests, [command.request_id]: plugin.id },
      );
      await this.governance.bindProjectResource({
        request_id: `plugin-connection-binding:${command.request_id}`,
        actor_id: command.actor_id,
        project_id: command.project_id,
        kind: 'plugin_connection',
        resource_id: command.connection_id,
        role: 'execute',
      });
      this.changes.fire({ kind: 'configured', plugin });
      return plugin;
    });
  }

  async command(input: PlatformPluginCommandInput): Promise<PlatformPlugin> {
    const command = platformPluginCommandInputSchema.parse(input);
    return this.enqueue(async () => {
      await this.ready;
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.requirePlugin(mapped);
      await this.authorization.assert({
        request_id: command.request_id,
        actor_id: command.actor_id,
        project_id: command.project_id,
        capability: 'plugin.install',
      });
      const current = this.requirePlugin(command.plugin_id);
      this.assertProject(current, command.project_id);
      const state = nextState(current.state, command.action);
      if (command.action === 'activate' && current.connection_id === undefined) {
        throw new PlatformPluginServiceError(
          PlatformPluginErrors.codes.PLATFORM_PLUGIN_INVALID_STATE,
          'plugin activation requires an opaque connection reference',
        );
      }
      const now = nowIsoDateTime();
      const plugin = platformPluginSchema.parse({
        ...current,
        state,
        updated_at: now,
        revoked_at: command.action === 'revoke' ? now : current.revoked_at,
      });
      await this.replace(
        this.plugins.map((candidate) => candidate.id === plugin.id ? plugin : candidate),
        { ...this.requests, [command.request_id]: plugin.id },
      );
      this.changes.fire({ kind: lifecycleEventKind(command.action), plugin });
      return plugin;
    });
  }

  private async load(): Promise<void> {
    const raw = await this.store.get<unknown>(this.scope, PLUGINS_KEY);
    if (raw === undefined) return;
    const document = documentSchema.parse(raw);
    this.plugins = document.plugins;
    this.requests = document.requests;
  }

  private async replace(plugins: readonly PlatformPlugin[], requests: Record<string, string>): Promise<void> {
    const document: PluginDocument = {
      version: DOCUMENT_VERSION,
      plugins: [...plugins],
      requests,
    };
    await this.store.set(this.scope, PLUGINS_KEY, document);
    this.plugins = document.plugins;
    this.requests = document.requests;
  }

  private requirePlugin(id: string): PlatformPlugin {
    const plugin = this.plugins.find((candidate) => candidate.id === id);
    if (plugin === undefined) {
      throw new PlatformPluginServiceError(
        PlatformPluginErrors.codes.PLATFORM_PLUGIN_NOT_FOUND,
        `platform plugin not found: ${id}`,
        { pluginId: id },
      );
    }
    return plugin;
  }

  private assertProject(plugin: PlatformPlugin, projectId: string): void {
    if (plugin.project_id !== projectId) {
      throw new PlatformPluginServiceError(
        PlatformPluginErrors.codes.PLATFORM_PLUGIN_PROJECT_MISMATCH,
        `platform plugin does not belong to project: ${projectId}`,
        { pluginId: plugin.id, projectId },
      );
    }
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(work, work);
    this.mutationQueue = next.then(() => undefined, () => undefined);
    return next;
  }
}

function nextState(
  current: PlatformPlugin['state'],
  action: PlatformPluginCommandInput['action'],
): PlatformPlugin['state'] {
  if (action === 'activate') {
    if (current !== 'configured' && current !== 'authorized' && current !== 'paused') {
      throw new PlatformPluginServiceError(
        PlatformPluginErrors.codes.PLATFORM_PLUGIN_INVALID_STATE,
        `plugin cannot activate from state: ${current}`,
      );
    }
    return 'active';
  }
  if (action === 'pause') {
    if (current !== 'active') {
      throw new PlatformPluginServiceError(
        PlatformPluginErrors.codes.PLATFORM_PLUGIN_INVALID_STATE,
        `plugin cannot pause from state: ${current}`,
      );
    }
    return 'paused';
  }
  return action === 'revoke' ? 'revoked' : 'uninstalled';
}

function lifecycleEventKind(
  action: PlatformPluginCommandInput['action'],
): PlatformPluginChangedEvent['kind'] {
  if (action === 'activate') return 'activated';
  if (action === 'revoke') return 'revoked';
  if (action === 'uninstall') return 'uninstalled';
  return 'paused';
}

registerScopedService(
  LifecycleScope.App,
  IPlatformPluginService,
  PlatformPluginService,
  ScopeActivation.OnScopeCreated,
  'platformPlugins',
);
