/**
 * Shared conformance suite — the guarantee that the ipc and memory
 * transports are interchangeable. Every transport test file runs the exact
 * same assertions against a real in-process engine; only the `before` setup
 * differs per file.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Service } from '@spiderbyte/agent-core/_base/di/service';
import { CommandContribution } from '@spiderbyte/agent-core/agent/command/commandContribution';
import { IFeatureManager } from '@spiderbyte/agent-core/app/feature/featureManager';

import type { Klient } from '../../src/index.js';
import type { TestEngine } from './engine.js';

export interface KlientConformanceTarget {
  readonly klient: Klient;
  /**
   * The in-process engine's App scope. Both transports boot the engine
   * in-process, so the suite can assemble dynamic units (e.g. contributed
   * commands) through the production `IFeatureManager` path.
   */
  readonly app: TestEngine['app'];
  cleanup(): Promise<void>;
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

export function defineKlientConformance(
  transport: string,
  makeTarget: () => Promise<KlientConformanceTarget>,
): void {
  describe(`klient conformance: ${transport}`, () => {
    let target: KlientConformanceTarget;

    beforeAll(async () => {
      target = await makeTarget();
    });

    afterAll(async () => {
      await target.cleanup();
    });

    it('env() aggregates the host snapshot', async () => {
      const env = await target.klient.global.env();
      expect(env.platform).toBe(process.platform);
      expect(env.homeDir.length).toBeGreaterThan(0);
      expect(env.clientVersion.length).toBeGreaterThan(0);
    });

    it('workspaces round-trip through create/get/update/list/delete', async () => {
      const workspaces = target.klient.global.workspaces;
      const created = await workspaces.createOrTouch({ root: process.cwd(), name: 'conformance' });
      expect(created.id.length).toBeGreaterThan(0);

      const fetched = await workspaces.get(created.id);
      expect(fetched?.name).toBe('conformance');

      const updated = await workspaces.update({ id: created.id, patch: { name: 'conformance-2' } });
      expect(updated?.name).toBe('conformance-2');

      const list = await workspaces.list();
      expect(list.some((w) => w.id === created.id)).toBe(true);

      await workspaces.delete(created.id);
      expect(await workspaces.get(created.id)).toBeUndefined();
    });

    it('platform services round-trip through the global facade', async () => {
      const workDir = await mkdtemp(join(tmpdir(), 'klient-conf-platform-'));
      let workspaceId: string | undefined;
      try {
        const platform = target.klient.global.platform;
        const workspace = await target.klient.global.workspaces.createOrTouch({
          root: workDir,
          name: 'platform-conformance',
        });
        workspaceId = workspace.id;
        const liveEvents: string[] = [];
        const liveSubscription = platform.platformEvents.subscribe(
          workspace.id,
          (event) => liveEvents.push(event.event_type),
          { entityTypes: ['provider_connection'] },
        );

        const connection = await platform.connections.create(workspace.id, {
          request_id: 'platform-connection-create',
          name: 'conformance-provider',
          provider: 'openai',
          scope: 'workspace',
          secret_ref: 'secret_conformance_provider',
          capabilities: ['chat'],
        });
        expect(connection).toMatchObject({
          workspace_id: workspace.id,
          name: 'conformance-provider',
          secret_ref: 'secret_conformance_provider',
          state: 'configured',
        });
        expect(connection).not.toHaveProperty('api_key');
        expect(await platform.connections.list(workspace.id)).toEqual([connection]);

        const executionTarget = await platform.executionTargets.register(workspace.id, {
          request_id: 'platform-target-create',
          name: 'conformance-local-target',
          type: 'local',
          locality: 'local',
          capabilities: ['analysis'],
        });
        expect(executionTarget).toMatchObject({
          workspace_id: workspace.id,
          type: 'local',
          health_status: 'unknown',
          authentication_method: 'none',
        });
        await expect(platform.executionTargets.test(workspace.id, executionTarget.id, {
          request_id: 'platform-target-test',
        })).resolves.toMatchObject({
          target_id: executionTarget.id,
          workspace_id: workspace.id,
          status: 'healthy',
          capabilities: ['analysis'],
        });
        await expect(platform.executionTargets.revoke(workspace.id, executionTarget.id, {
          request_id: 'platform-target-revoke',
        })).resolves.toMatchObject({ state: 'disabled' });

        // Exercise optional positional arguments through both transports. IPC
        // must omit trailing undefined values instead of serializing nulls.
        expect(await platform.resources.list(workspace.id)).toEqual([]);
        expect(await platform.artifacts.list(workspace.id)).toEqual([]);
        expect(await platform.automations.history(workspace.id)).toEqual([]);
        expect(await platform.usage.usageSummary(workspace.id)).toMatchObject({
          workspace_id: workspace.id,
          record_count: 0,
        });
        await waitFor(() => liveEvents.includes('provider_connection.created'), 5_000);

        const replay = await platform.platformEvents.replay(workspace.id);
        expect(replay.events).toEqual(expect.arrayContaining([
          expect.objectContaining({
          event_type: 'provider_connection.created',
          entity_type: 'provider_connection',
          entity_id: connection.id,
          request_id: 'platform-connection-create',
          }),
        ]));
        liveSubscription.dispose();

        const organization = await platform.governance.ensureLocalOrganization('conformance-owner');
        const project = await platform.governance.createProject({
          request_id: 'platform-project-create',
          actor_id: 'conformance-owner',
          organization_id: organization.id,
          name: 'platform-conformance-project',
        });
        const boundProject = await platform.governance.bindWorkspace(project.id, {
          request_id: 'platform-project-bind',
          actor_id: 'conformance-owner',
          workspace_id: workspace.id,
        });
        expect(boundProject.workspace_ids).toContain(workspace.id);
        await expect(platform.governance.projectForWorkspace(workspace.id)).resolves.toMatchObject({
          id: project.id,
          organization_id: organization.id,
        });

        const projectBinding = await platform.governance.bindProjectResource({
          request_id: 'platform-project-binding',
          actor_id: 'conformance-owner',
          project_id: project.id,
          workspace_id: workspace.id,
          kind: 'llm_connection',
          resource_id: connection.id,
          role: 'default',
        });
        expect(projectBinding).toMatchObject({
          project_id: project.id,
          workspace_id: workspace.id,
          resource_id: connection.id,
          state: 'active',
        });
        await expect(
          platform.governance.listProjectBindings(project.id, workspace.id),
        ).resolves.toEqual([projectBinding]);
        await expect(platform.authorization.evaluate({
          request_id: 'platform-authorization-owner',
          actor_id: 'conformance-owner',
          project_id: project.id,
          workspace_id: workspace.id,
          capability: 'run.execute',
        })).resolves.toMatchObject({
          allowed: true,
          role: 'organization_owner',
          project_id: project.id,
          workspace_id: workspace.id,
        });
        await expect(
          platform.governance.removeProjectBinding({
            request_id: 'platform-project-binding-remove',
            actor_id: 'conformance-owner',
            project_id: project.id,
            binding_id: projectBinding.id,
          }),
        ).resolves.toMatchObject({ id: projectBinding.id, state: 'disabled' });
      } finally {
        if (workspaceId !== undefined) await target.klient.global.workspaces.delete(workspaceId);
        await rm(workDir, { recursive: true, force: true });
      }
    });

    it('sessions index responds with a page shape', async () => {
      const page = await target.klient.global.sessions.list({});
      expect(Array.isArray(page.items)).toBe(true);
      const count = await target.klient.global.sessions.countActive(['no-such-workspace']);
      expect(typeof count).toBe('number');
    });

    it('creates a titled session through implicit workspace materialization', async () => {
      const created = await target.klient.global.sessions.create({
        workDir: process.cwd(),
        title: 'conformance session',
      });

      try {
        expect(created).toMatchObject({
          title: 'conformance session',
          cwd: process.cwd(),
          archived: false,
        });
        expect(created.id.length).toBeGreaterThan(0);
        expect(await target.klient.global.sessions.get(created.id)).toMatchObject({
          id: created.id,
          title: 'conformance session',
        });
      } finally {
        await target.klient.session(created.id).close();
      }
    });

    it('session skills.list returns the workspace skills as summaries', async () => {
      const workDir = await mkdtemp(join(tmpdir(), 'klient-conf-skills-'));
      try {
        await mkdir(join(workDir, '.spiderbyte', 'skills', 'conf-skill'), { recursive: true });
        await writeFile(
          join(workDir, '.spiderbyte', 'skills', 'conf-skill', 'SKILL.md'),
          '---\nname: conf-skill\ndescription: conformance fixture skill\n---\n\n# Conf\n',
        );
        const created = await target.klient.global.sessions.create({ workDir });
        try {
          const skills = await target.klient.session(created.id).skills.list();
          expect(skills.find((skill) => skill.name === 'conf-skill')).toMatchObject({
            name: 'conf-skill',
            description: 'conformance fixture skill',
            source: 'project',
          });
        } finally {
          await target.klient.session(created.id).close();
        }
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    });

    it('providers.set/get/delete works and emits kosong.providers.changed', async () => {
      const events: Array<{
        added: readonly string[];
        removed: readonly string[];
        changed: readonly string[];
      }> = [];
      const errors: Error[] = [];
      target.klient.events.onError((error) => {
        errors.push(error);
      });
      const sub = target.klient.events.on('kosong.providers.changed', (event) => {
        events.push(event);
      });
      // Give the subscription a wire round-trip (memory is synchronous; ipc
      // and http's lazy WS need a frame exchange).
      await new Promise((resolve) => {
        setTimeout(resolve, 300);
      });

      const name = '__klient_conformance__';
      try {
        await target.klient.global.kosong.addProvider(name, {
          type: 'openai',
          auth: { method: 'api-key', apiKey: 'conf-key' },
        });
        const got = await target.klient.global.kosong.getProvider(name);
        expect(got.has_api_key).toBe(true);

        await waitFor(
          () => events.some((event) => [...event.added, ...event.changed].includes(name)),
          5_000,
        );
      } finally {
        await target.klient.global.kosong.removeProvider(name);
        sub.dispose();
      }
      expect(errors).toEqual([]);
    });

    it('config reads respond', async () => {
      const all = await target.klient.global.config.getAll();
      expect(typeof all).toBe('object');
      expect(Array.isArray(await target.klient.global.config.diagnostics())).toBe(true);
    });

    it('config replaceSections writes several domains and clears undefined ones', async () => {
      const config = target.klient.global.config;
      const beforeProviders = await config.inspect<Record<string, unknown>>('providers');
      const beforeModels = await config.inspect<Record<string, unknown>>('models');
      try {
        await config.replaceSections({
          sections: {
            providers: {
              ...beforeProviders.userValue,
              'conf-provider': { type: 'openai', baseUrl: 'http://127.0.0.1:1', apiKey: 'k' },
            },
            models: {
              ...beforeModels.userValue,
              'conf-provider/m1': { provider: 'conf-provider', model: 'm1', maxContextSize: 100 },
            },
            defaultModel: 'conf-provider/m1',
          },
        });
        expect((await config.inspect<string>('defaultModel')).userValue).toBe('conf-provider/m1');

        // A domain mapped to `undefined` is cleared; domains absent from the
        // sections record are left untouched.
        await config.replaceSections({ sections: { defaultModel: undefined } });
        expect((await config.inspect<string>('defaultModel')).userValue).toBeUndefined();
        const providers = await config.inspect<Record<string, unknown>>('providers');
        expect(providers.userValue?.['conf-provider']).toBeDefined();
      } finally {
        await config.replaceSections({
          sections: { providers: beforeProviders.userValue, models: beforeModels.userValue },
        });
      }
    });

    it('hostFs.home() returns the host home and recent roots', async () => {
      const home = await target.klient.global.hostFs.home();
      expect(home.home.length).toBeGreaterThan(0);
      expect(Array.isArray(home.recent_roots)).toBe(true);

      const browse = await target.klient.global.hostFs.browse(home.home);
      expect(browse.path).toBe(home.home);
      expect(Array.isArray(browse.entries)).toBe(true);
    });

    it('kosong lists models/providers and anonymous provider round-trips', async () => {
      const kosong = target.klient.global.kosong;
      expect(Array.isArray(await kosong.listModels())).toBe(true);
      expect(Array.isArray(await kosong.listProviders())).toBe(true);

      const events: Array<{
        added: readonly string[];
        removed: readonly string[];
        changed: readonly string[];
      }> = [];
      const sub = target.klient.events.on('kosong.models.changed', (event) => {
        events.push(event);
      });
      // See kosong.providers.changed above — give the subscription a wire round-trip.
      await new Promise((resolve) => {
        setTimeout(resolve, 300);
      });

      const id = '__klient_conformance__';
      try {
        await kosong.addProvider({
          id,
          model: 'conf-model',
          protocol: 'openai',
          baseUrl: 'http://127.0.0.1:1',
          auth: { method: 'api-key', apiKey: 'conf-key' },
        });

        await waitFor(
          () => events.some((event) => [...event.added, ...event.changed].includes(id)),
          5_000,
        );
      } finally {
        await kosong.removeProvider(id);
        sub.dispose();
      }
    });

    it('flags / plugins / auth read models respond', async () => {
      expect(Array.isArray(await target.klient.global.flags.list())).toBe(true);
      expect(Array.isArray(await target.klient.global.flags.enabledIds())).toBe(true);
      expect(typeof await target.klient.global.flags.snapshot()).toBe('object');
      expect(Array.isArray(await target.klient.global.plugins.list())).toBe(true);
      const status = await target.klient.global.auth.status();
      expect(typeof status.loggedIn).toBe('boolean');
    });

    it('agent commands list and run a contributed command', async () => {
      const created = await target.klient.global.sessions.create({
        workDir: process.cwd(),
        title: 'conformance commands',
      });
      const calls: string[] = [];

      // A dynamic App-scope unit contributing one command into the
      // `CommandContribution` collection — the same path a Feature takes.
      class ConformanceCommands extends Service {
        static override readonly name = 'klient-conformance-commands';
        constructor() {
          super();
          this.provide(CommandContribution, {
            name: 'conformance-echo',
            description: 'records its args',
            run: (ctx) => {
              calls.push(ctx.args);
            },
          });
        }
      }

      const featureManager = target.app.accessor.get(IFeatureManager);
      const handle = featureManager.provideUnit(ConformanceCommands);
      try {
        const agent = target.klient.session(created.id).agent('main');

        // Dynamic assembly goes through the cascade — poll until visible.
        let infos = await agent.listCommands();
        const deadline = Date.now() + 5_000;
        while (!infos.some((command) => command.name === 'conformance-echo')) {
          if (Date.now() > deadline) break;
          await new Promise((resolve) => {
            setTimeout(resolve, 25);
          });
          infos = await agent.listCommands();
        }
        expect(infos.map((command) => command.name)).toContain('conformance-echo');
        const echo = infos.find((command) => command.name === 'conformance-echo');
        expect(echo).toMatchObject({ name: 'conformance-echo', description: 'records its args' });
        expect(typeof echo?.source).toBe('string');

        await agent.runCommand({ name: 'conformance-echo', args: 'hello commands' });
        expect(calls).toEqual(['hello commands']);

        // Unknown names fail with a coded engine error.
        await expect(agent.runCommand({ name: 'conformance-missing' })).rejects.toThrow(
          /Unknown command/,
        );
      } finally {
        await handle.dispose();
        await target.klient.session(created.id).close();
      }
    });
  });
}
