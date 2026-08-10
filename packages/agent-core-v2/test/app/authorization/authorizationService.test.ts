/** Shared capability authorization must evaluate membership, project scope, and workspace scope. */

import { beforeEach, describe, expect, it } from 'vitest';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IPlatformAuthorizationService } from '#/app/authorization/authorization';
import { PlatformAuthorizationService } from '#/app/authorization/authorizationService';
import { IPlatformGovernanceService } from '#/app/governance/governance';
import { PlatformGovernanceService } from '#/app/governance/governanceService';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';

describe('PlatformAuthorizationService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    const documents = new Map<string, unknown>();
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
  });

  it('applies organization and project roles to the same capability contract', async () => {
    const governance = ix.get(IPlatformGovernanceService);
    const authorization = ix.get(IPlatformAuthorizationService);
    const organization = await governance.createOrganization({
      request_id: 'authorization-organization',
      actor_id: 'owner',
      name: 'Authorization test',
      mode: 'local',
    });
    const project = await governance.createProject({
      request_id: 'authorization-project',
      actor_id: 'owner',
      organization_id: organization.id,
      name: 'Authorization project',
    });
    await governance.upsertProjectMember({
      request_id: 'authorization-operator',
      actor_id: 'owner',
      project_id: project.id,
      member_id: 'operator',
      role: 'operator',
    });

    await expect(authorization.evaluate({
      request_id: 'authorization-owner-run',
      actor_id: 'owner',
      project_id: project.id,
      capability: 'run.execute',
    })).resolves.toMatchObject({ allowed: true, role: 'organization_owner' });

    await expect(authorization.evaluate({
      request_id: 'authorization-operator-run',
      actor_id: 'operator',
      project_id: project.id,
      capability: 'run.execute',
    })).resolves.toMatchObject({ allowed: true, role: 'operator' });

    await expect(authorization.evaluate({
      request_id: 'authorization-operator-plugin',
      actor_id: 'operator',
      project_id: project.id,
      capability: 'plugin.install',
    })).resolves.toMatchObject({ allowed: false, role: undefined });

    await expect(authorization.evaluate({
      request_id: 'authorization-unknown',
      actor_id: 'unknown',
      project_id: project.id,
      capability: 'project.read',
    })).resolves.toMatchObject({ allowed: false, reason: expect.stringContaining('not a member') });
  });

  it('denies a workspace capability outside the project binding', async () => {
    const governance = ix.get(IPlatformGovernanceService);
    const authorization = ix.get(IPlatformAuthorizationService);
    const organization = await governance.createOrganization({
      request_id: 'workspace-authorization-organization',
      actor_id: 'owner',
      name: 'Workspace authorization test',
      mode: 'local',
    });
    const project = await governance.createProject({
      request_id: 'workspace-authorization-project',
      actor_id: 'owner',
      organization_id: organization.id,
      name: 'Workspace authorization project',
    });
    await governance.bindWorkspace(project.id, {
      request_id: 'workspace-authorization-bind',
      actor_id: 'owner',
      workspace_id: 'wd_authorization_bound_0123456789ab',
    });

    await expect(authorization.evaluate({
      request_id: 'workspace-authorization-denied',
      actor_id: 'owner',
      project_id: project.id,
      workspace_id: 'wd_authorization_other_0123456789ab',
      capability: 'run.execute',
    })).resolves.toMatchObject({
      allowed: false,
      reason: 'workspace is not bound to the requested project',
    });
  });
});
