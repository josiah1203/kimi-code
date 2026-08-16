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

  it('synchronizes a hosted organization snapshot idempotently and removes stale project members', async () => {
    const service = ix.get(IPlatformGovernanceService);
    const organization = await service.synchronizeHostedOrganization({
      request_id: 'hosted_sync_1',
      organization_id: 'org_hosted_example',
      name: 'Hosted Example',
      mode: 'hosted',
      members: [
        { member_id: 'usr_owner', role: 'organization_owner' },
        { member_id: 'usr_member', role: 'member' },
      ],
    });

    const project = await service.createProject({
      request_id: 'hosted_project_create',
      actor_id: 'usr_owner',
      organization_id: organization.id,
      name: 'Hosted project',
    });
    await service.upsertProjectMember({
      request_id: 'hosted_project_member',
      actor_id: 'usr_owner',
      project_id: project.id,
      member_id: 'usr_member',
      role: 'member',
    });

    const replay = await service.synchronizeHostedOrganization({
      request_id: 'hosted_sync_2',
      organization_id: 'org_hosted_example',
      name: 'Hosted Example',
      mode: 'hosted',
      members: [{ member_id: 'usr_owner', role: 'organization_owner' }],
    });

    const secondReplay = await service.synchronizeHostedOrganization({
      request_id: 'hosted_sync_2',
      organization_id: 'org_hosted_example',
      name: 'Hosted Example',
      mode: 'hosted',
      members: [{ member_id: 'usr_owner', role: 'organization_owner' }],
    });

    expect(secondReplay).toEqual(replay);
    expect(replay).toMatchObject({ id: organization.id, mode: 'hosted' });
    await expect(service.listOrganizationMembers(organization.id)).resolves.toEqual([
      expect.objectContaining({ member_id: 'usr_owner', role: 'organization_owner' }),
    ]);
    await expect(service.listProjectMembers(project.id)).resolves.toEqual([
      expect.objectContaining({ member_id: 'usr_owner', role: 'project_administrator' }),
    ]);
  });

  it('rejects hosted synchronization without an owner or with duplicate members', async () => {
    const service = ix.get(IPlatformGovernanceService);

    await expect(service.synchronizeHostedOrganization({
      request_id: 'hosted_sync_no_owner',
      organization_id: 'org_hosted_no_owner',
      name: 'No owner',
      mode: 'hosted',
      members: [{ member_id: 'usr_member', role: 'member' }],
    })).rejects.toMatchObject({ code: 'governance.invalid' });

    await expect(service.synchronizeHostedOrganization({
      request_id: 'hosted_sync_duplicate',
      organization_id: 'org_hosted_duplicate',
      name: 'Duplicate members',
      mode: 'hosted',
      members: [
        { member_id: 'usr_owner', role: 'organization_owner' },
        { member_id: 'usr_owner', role: 'member' },
      ],
    })).rejects.toMatchObject({ code: 'governance.invalid' });
  });

  it('binds an explicitly approved workspace only to a project in the hosted organization', async () => {
    const service = ix.get(IPlatformGovernanceService);
    const organization = await service.synchronizeHostedOrganization({
      request_id: 'hosted_binding_sync',
      organization_id: 'org_hosted_binding',
      name: 'Hosted binding',
      mode: 'hosted',
      members: [
        { member_id: 'usr_hosted_owner', role: 'organization_owner' },
        { member_id: 'usr_hosted_member', role: 'member' },
      ],
    });
    const project = await service.createProject({
      request_id: 'hosted_binding_project',
      actor_id: 'usr_hosted_owner',
      organization_id: organization.id,
      name: 'Approved project',
    });

    const bound = await service.bindHostedWorkspace({
      request_id: 'hosted_binding_request',
      organization_id: organization.id,
      project_id: project.id,
      workspace_id: 'wd_hosted_binding_0123456789ab',
      owner_member_id: 'usr_hosted_owner',
    });
    const replay = await service.bindHostedWorkspace({
      request_id: 'hosted_binding_request',
      organization_id: organization.id,
      project_id: project.id,
      workspace_id: 'wd_hosted_binding_0123456789ab',
      owner_member_id: 'usr_hosted_owner',
    });

    expect(bound.workspace_ids).toEqual(['wd_hosted_binding_0123456789ab']);
    expect(replay).toEqual(bound);
    await expect(service.bindHostedWorkspace({
      request_id: 'hosted_binding_denied',
      organization_id: organization.id,
      project_id: project.id,
      workspace_id: 'wd_hosted_binding_2_0123456789ab',
      owner_member_id: 'usr_hosted_member',
    })).rejects.toMatchObject({ code: 'governance.membership_denied' });
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
