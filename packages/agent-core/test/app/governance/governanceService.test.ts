/**
 * Scenario: accountless local mode still has an explicit SpiderByte control
 * plane. The service is tested through its public organization/project APIs;
 * the document store is the only external boundary.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { IPlatformGovernanceService } from '#/app/governance/governance';
import { PlatformGovernanceService } from '#/app/governance/governanceService';

describe('PlatformGovernanceService', () => {
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
  });

  afterEach(() => {
    disposables.dispose();
  });

  it('creates a local organization and project with an explicit workspace binding', async () => {
    const service = ix.get(IPlatformGovernanceService);
    const organization = await service.ensureLocalOrganization('user_local');
    const project = await service.createProject({
      request_id: 'project_create',
      actor_id: 'user_local',
      organization_id: organization.id,
      name: 'Local ML',
    });
    const bound = await service.bindWorkspace(project.id, {
      request_id: 'project_bind_workspace',
      actor_id: 'user_local',
      workspace_id: 'wd_local_project_0123456789ab',
    });

    expect(organization).toMatchObject({ mode: 'local', name: 'Local SpiderByte' });
    expect(bound.workspace_ids).toEqual(['wd_local_project_0123456789ab']);
    await expect(service.projectForWorkspace('wd_local_project_0123456789ab')).resolves.toEqual(bound);
  });

  it('does not hand an existing local organization to an unlisted actor', async () => {
    const service = ix.get(IPlatformGovernanceService);
    await service.ensureLocalOrganization('user_local');

    await expect(service.ensureLocalOrganization('other_actor')).rejects.toMatchObject({
      code: 'governance.membership_denied',
    });
  });

  it('rejects project mutation by a member without administration authority', async () => {
    const service = ix.get(IPlatformGovernanceService);
    const organization = await service.createOrganization({
      request_id: 'organization_create',
      actor_id: 'user_owner',
      name: 'Business test',
      mode: 'local',
    });
    await service.upsertOrganizationMember({
      request_id: 'organization_member',
      actor_id: 'user_owner',
      organization_id: organization.id,
      member_id: 'user_member',
      role: 'member',
    });

    await expect(service.createProject({
      request_id: 'project_denied',
      actor_id: 'user_member',
      organization_id: organization.id,
      name: 'Denied',
    })).rejects.toMatchObject({ code: 'governance.membership_denied' });
  });

  it('prevents one workspace from being bound to multiple projects', async () => {
    const service = ix.get(IPlatformGovernanceService);
    const organization = await service.ensureLocalOrganization('user_local');
    const first = await service.createProject({
      request_id: 'first_project_create',
      actor_id: 'user_local',
      organization_id: organization.id,
      name: 'First',
    });
    const second = await service.createProject({
      request_id: 'second_project_create',
      actor_id: 'user_local',
      organization_id: organization.id,
      name: 'Second',
    });
    const workspaceId = 'wd_single_project_0123456789ab';
    await service.bindWorkspace(first.id, {
      request_id: 'first_project_bind',
      actor_id: 'user_local',
      workspace_id: workspaceId,
    });

    await expect(service.bindWorkspace(second.id, {
      request_id: 'second_project_bind',
      actor_id: 'user_local',
      workspace_id: workspaceId,
    })).rejects.toMatchObject({ code: 'governance.workspace_already_bound' });
  });

  it('stores project-owned resource references without credentials and allows project admins to revoke them', async () => {
    const service = ix.get(IPlatformGovernanceService);
    const organization = await service.ensureLocalOrganization('user_local');
    const project = await service.createProject({
      request_id: 'binding_project_create',
      actor_id: 'user_local',
      organization_id: organization.id,
      name: 'Bound resources',
    });
    const binding = await service.bindProjectResource({
      request_id: 'binding_create',
      actor_id: 'user_local',
      project_id: project.id,
      kind: 'llm_connection',
      resource_id: 'connection_openrouter_managed',
      role: 'default',
    });

    expect(binding).toMatchObject({
      project_id: project.id,
      kind: 'llm_connection',
      resource_id: 'connection_openrouter_managed',
      role: 'default',
      state: 'active',
    });
    expect(JSON.stringify(documents.get('spiderbyte-governance.json'))).not.toContain('api_key');

    await expect(service.bindProjectResource({
      request_id: 'binding_duplicate',
      actor_id: 'user_local',
      project_id: project.id,
      kind: 'llm_connection',
      resource_id: 'connection_other',
      role: 'default',
    })).rejects.toMatchObject({ code: 'governance.binding_conflict' });

    const revoked = await service.removeProjectBinding({
      request_id: 'binding_remove',
      actor_id: 'user_local',
      project_id: project.id,
      binding_id: binding.id,
    });
    expect(revoked).toMatchObject({ id: binding.id, state: 'disabled' });
    await expect(service.listProjectBindings(project.id)).resolves.toEqual([revoked]);
  });
});
