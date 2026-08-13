import { describe, expect, it, vi } from 'vitest';

import {
  AuthorizationErrors,
  AuthorizationServiceError,
  IPlatformAuthorizationService,
  IPlatformGovernanceService,
  ISessionIndex,
  type Scope,
} from '@spiderbyte/agent-core';

import {
  assertOrganizationAuthorization,
  assertProjectAuthorization,
  assertSessionAuthorization,
  assertWorkspaceAuthorization,
  isWorkspaceAuthorized,
  listAuthorizedOrganizations,
  listAuthorizedProjects,
} from '../src/services/platformAuthorization';

function coreFor(options: {
  readonly project?: { readonly id: string };
  readonly session?: { readonly id: string; readonly workspaceId: string };
  readonly organization?: { readonly id: string };
  readonly organizations?: readonly { readonly id: string }[];
  readonly projects?: readonly { readonly id: string }[];
  readonly organizationMembers?: readonly { readonly member_id: string }[];
  readonly projectDecisions?: Readonly<Record<string, boolean>>;
  readonly bindings?: {
    readonly kind: 'execution_target';
    readonly state: 'active' | 'disabled';
    readonly resource_id: string;
    readonly role: 'allowed' | 'default' | 'fallback' | 'execute' | 'read';
  };
} = {}): {
  readonly core: Scope;
  readonly assert: ReturnType<typeof vi.fn>;
} {
  const governance = {
    projectForWorkspace: vi.fn(async () => options.project),
    getOrganization: vi.fn(async () => options.organization),
    listOrganizations: vi.fn(async () => options.organizations ?? []),
    listOrganizationMembers: vi.fn(async () => options.organizationMembers ?? []),
    listProjects: vi.fn(async () => options.projects ?? []),
    getProject: vi.fn(async () => options.project),
    listProjectBindings: vi.fn(async () => options.bindings === undefined ? [] : [options.bindings]),
  };
  const assert = vi.fn(async () => undefined);
  const evaluate = vi.fn(async (input: { readonly project_id: string }) => ({
    allowed: options.projectDecisions?.[input.project_id] ?? true,
  }));
  return {
    core: {
      accessor: {
        get: (identifier: unknown) => {
          if (identifier === IPlatformGovernanceService) return governance;
          if (identifier === IPlatformAuthorizationService) return { assert, evaluate };
          if (identifier === ISessionIndex) return { get: vi.fn(async () => options.session) };
          throw new Error('unexpected service lookup');
        },
      },
    } as unknown as Scope,
    assert,
  };
}

describe('platform authorization edge', () => {
  it('allows an unbound workspace under the documented accountless local trust model', async () => {
    const { core, assert } = coreFor();
    await assertWorkspaceAuthorization(core, {
      workspaceId: 'workspace_a',
      requestId: 'request_a',
      capability: 'workspace.read',
    });
    expect(assert).not.toHaveBeenCalled();
  });

  it('derives the actor from the server environment for a bound workspace', async () => {
    vi.stubEnv('SPIDERBYTE_LOCAL_ACTOR_ID', 'server-actor');
    const { core, assert } = coreFor({ project: { id: 'project_a' } });
    await assertWorkspaceAuthorization(core, {
      workspaceId: 'workspace_a',
      requestId: 'request_a',
      capability: 'data.read',
    });
    expect(assert).toHaveBeenCalledWith(expect.objectContaining({
      actor_id: 'server-actor',
      project_id: 'project_a',
      workspace_id: 'workspace_a',
      capability: 'data.read',
    }));
    vi.unstubAllEnvs();
  });

  it('denies a bound workspace when the authorization service rejects membership', async () => {
    const { core, assert } = coreFor({ project: { id: 'project_a' } });
    assert.mockRejectedValueOnce(new AuthorizationServiceError(
      AuthorizationErrors.codes.AUTHORIZATION_DENIED,
      'denied',
    ));
    await expect(assertWorkspaceAuthorization(core, {
      workspaceId: 'workspace_a',
      requestId: 'request_a',
      capability: 'workspace.read',
    })).rejects.toMatchObject({ code: AuthorizationErrors.codes.AUTHORIZATION_DENIED });
  });

  it('filters workspace listings without hiding authorization-service failures', async () => {
    const { core, assert } = coreFor({ project: { id: 'project_a' } });
    await expect(isWorkspaceAuthorized(core, {
      workspaceId: 'workspace_a',
      requestId: 'request_a',
      capability: 'workspace.read',
    })).resolves.toBe(true);
    assert.mockRejectedValueOnce(new AuthorizationServiceError(
      AuthorizationErrors.codes.AUTHORIZATION_DENIED,
      'denied',
    ));
    await expect(isWorkspaceAuthorized(core, {
      workspaceId: 'workspace_a',
      requestId: 'request_b',
      capability: 'workspace.read',
    })).resolves.toBe(false);
  });

  it('denies an execution target that is not bound to the project', async () => {
    const { core } = coreFor({
      project: { id: 'project_a' },
      bindings: {
        kind: 'execution_target',
        state: 'active',
        resource_id: 'target_allowed',
        role: 'execute',
      },
    });
    await expect(assertWorkspaceAuthorization(core, {
      workspaceId: 'workspace_a',
      requestId: 'request_a',
      capability: 'execution.execute',
      executionTargetId: 'target_other',
    })).rejects.toMatchObject({ code: AuthorizationErrors.codes.AUTHORIZATION_DENIED });
  });

  it('filters organization and project reads to the server-derived actor', async () => {
    vi.stubEnv('SPIDERBYTE_LOCAL_ACTOR_ID', 'server-actor');
    const { core } = coreFor({
      organizations: [{ id: 'org_visible' }, { id: 'org_hidden' }],
      organizationMembers: [{ member_id: 'server-actor' }],
      projects: [{ id: 'project_visible' }, { id: 'project_hidden' }],
      projectDecisions: { project_visible: true, project_hidden: false },
    });

    await expect(listAuthorizedOrganizations(core)).resolves.toEqual([{ id: 'org_visible' }]);
    await expect(listAuthorizedProjects(core)).resolves.toEqual([{ id: 'project_visible' }]);
    vi.unstubAllEnvs();
  });

  it('resolves a session workspace before authorizing session access', async () => {
    const { core, assert } = coreFor({
      session: { id: 'session_a', workspaceId: 'workspace_a' },
      project: { id: 'project_a' },
    });
    await expect(assertSessionAuthorization(core, {
      sessionId: 'session_a',
      requestId: 'request_session',
      capability: 'data.read',
    })).resolves.toEqual({ id: 'session_a', workspaceId: 'workspace_a' });
    expect(assert).toHaveBeenCalledWith(expect.objectContaining({
      workspace_id: 'workspace_a',
      capability: 'data.read',
    }));
  });

  it('denies non-member governance reads and accepts a member project read', async () => {
    vi.stubEnv('SPIDERBYTE_LOCAL_ACTOR_ID', 'server-actor');
    const { core } = coreFor({
      organization: { id: 'org_a' },
      project: { id: 'project_a' },
      organizationMembers: [{ member_id: 'other-actor' }],
    });
    await expect(assertOrganizationAuthorization(core, {
      organizationId: 'org_a',
      requestId: 'request_org',
    })).rejects.toMatchObject({ code: AuthorizationErrors.codes.AUTHORIZATION_DENIED });
    await expect(assertProjectAuthorization(core, {
      projectId: 'project_a',
      requestId: 'request_project',
      capability: 'project.read',
    })).resolves.toEqual({ id: 'project_a' });
    vi.unstubAllEnvs();
  });
});
