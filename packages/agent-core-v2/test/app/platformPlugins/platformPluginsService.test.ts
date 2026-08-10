/** Business plugins are durable project records, not a second Kimi plugin authority. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IPlatformAuthorizationService } from '#/app/authorization/authorization';
import { PlatformAuthorizationService } from '#/app/authorization/authorizationService';
import { IPlatformGovernanceService } from '#/app/governance/governance';
import { PlatformGovernanceService } from '#/app/governance/governanceService';
import { IPlatformPluginService } from '#/app/platformPlugins/platformPlugins';
import { PlatformPluginService } from '#/app/platformPlugins/platformPluginsService';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { platformPluginManifestSchema } from '@moonshot-ai/protocol';

describe('PlatformPluginService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let documents: Map<string, unknown>;

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    documents = new Map();
    ix.stub(IAtomicDocumentStore, {
      _serviceBrand: undefined,
      get: async (_scope: string, key: string) => documents.get(key),
      set: async (_scope: string, key: string, value: unknown) => { documents.set(key, value); },
      delete: async (_scope: string, key: string) => { documents.delete(key); },
      list: async () => [],
      watch: (() => ({ dispose: () => {} })) as never,
      acquire: () => ({ dispose: () => {} }),
    } as unknown as IAtomicDocumentStore);
    ix.stub(IBootstrapService, {
      _serviceBrand: undefined,
      scope: (name: string) => name,
    } as unknown as IBootstrapService);
    ix.set(IPlatformGovernanceService, new SyncDescriptor(PlatformGovernanceService));
    ix.set(IPlatformAuthorizationService, new SyncDescriptor(PlatformAuthorizationService));
    ix.set(IPlatformPluginService, new SyncDescriptor(PlatformPluginService));
  });

  afterEach(() => {
    disposables.dispose();
  });

  it('discovers, installs, configures, and transitions a project plugin using opaque references', async () => {
    const governance = ix.get(IPlatformGovernanceService);
    const service = ix.get(IPlatformPluginService);
    const organization = await governance.createOrganization({
      request_id: 'plugin-organization',
      actor_id: 'owner',
      name: 'Plugin test',
      mode: 'local',
    });
    const project = await governance.createProject({
      request_id: 'plugin-project',
      actor_id: 'owner',
      organization_id: organization.id,
      name: 'Plugin project',
    });
    const manifest = platformPluginManifestSchema.parse({
      id: 'example.integration',
      name: 'Example integration',
      version: '1.0.0',
      provider_type: 'example',
      authentication: { kind: 'oauth2', scopes: ['messages:write'] },
      required_secret_refs: ['secret_example_connection'],
      capabilities: ['run.execute'],
      commands: [{ id: 'run', name: 'Run', description: 'Run an operation', capability: 'run.execute' }],
      webhook_routes: [{ path: '/events', events: ['message.created'] }],
      privacy_requirements: ['do not persist message bodies'],
    });

    await expect(service.discover({
      request_id: 'plugin-discover',
      actor_id: 'owner',
      manifest,
    })).resolves.toMatchObject({ id: manifest.id, provider_type: 'example' });

    const installed = await service.install({
      request_id: 'plugin-install',
      actor_id: 'owner',
      project_id: project.id,
      manifest,
    });
    expect(installed).toMatchObject({ project_id: project.id, state: 'installed' });
    expect(JSON.stringify(documents.get('spiderbyte-platform-plugins.json'))).not.toContain('api_key');
    await expect(governance.listProjectBindings(project.id)).resolves.toEqual([
      expect.objectContaining({ kind: 'plugin_connection', resource_id: installed.id }),
    ]);

    const configured = await service.configure({
      request_id: 'plugin-configure',
      actor_id: 'owner',
      project_id: project.id,
      plugin_id: installed.id,
      connection_id: 'connection_example_oauth',
    });
    expect(configured).toMatchObject({ state: 'configured', connection_id: 'connection_example_oauth' });

    await expect(service.command({
      request_id: 'plugin-activate',
      actor_id: 'owner',
      project_id: project.id,
      plugin_id: installed.id,
      action: 'activate',
    })).resolves.toMatchObject({ state: 'active' });

    await expect(service.command({
      request_id: 'plugin-revoke',
      actor_id: 'owner',
      project_id: project.id,
      plugin_id: installed.id,
      action: 'revoke',
    })).resolves.toMatchObject({ state: 'revoked', revoked_at: expect.any(String) });
  });
});
