/** Server-owned local principal and workspace/project authorization boundary. */

import {
  AuthorizationErrors,
  AuthorizationServiceError,
  IPlatformAuthorizationService,
  IPlatformGovernanceService,
  ISessionIndex,
  type Scope,
  type SessionSummary,
} from '@spiderbyte/agent-core';
import type { Organization, PlatformCapability, Project } from '@spiderbyte/protocol';

export const SPIDERBYTE_LOCAL_ACTOR_ID_ENV = 'SPIDERBYTE_LOCAL_ACTOR_ID';
export const DEFAULT_LOCAL_ACTOR_ID = 'local-user';

/** Resolve only host-controlled identity; request bodies are never consulted. */
export function resolveLocalActorId(explicit?: string): string {
  return explicit ?? process.env[SPIDERBYTE_LOCAL_ACTOR_ID_ENV] ?? DEFAULT_LOCAL_ACTOR_ID;
}

/**
 * Enforce project membership for a workspace once the workspace is bound to a
 * project. Unbound workspaces remain accountless local Open Core resources;
 * that exception is the documented local trust model, not a hosted bypass.
 */
export async function assertWorkspaceAuthorization(
  core: Scope,
  input: {
    readonly workspaceId: string;
    readonly requestId: string;
    readonly capability: PlatformCapability;
    readonly actorId?: string;
    readonly executionTargetId?: string;
  },
): Promise<void> {
  const governance = core.accessor.get(IPlatformGovernanceService);
  const project = await governance.projectForWorkspace(input.workspaceId);
  if (project === undefined) return;

  const actorId = resolveLocalActorId(input.actorId);
  await core.accessor.get(IPlatformAuthorizationService).assert({
    request_id: authorizationRequestId(input.requestId),
    actor_id: actorId,
    project_id: project.id,
    workspace_id: input.workspaceId,
    capability: input.capability,
  });

  if (input.executionTargetId === undefined || input.capability !== 'execution.execute') return;
  const bindings = await governance.listProjectBindings(project.id, input.workspaceId);
  const executionBindings = bindings.filter(
    (binding) => binding.kind === 'execution_target' && binding.state === 'active',
  );
  if (executionBindings.length === 0) return;
  if (executionBindings.some((binding) =>
    binding.resource_id === input.executionTargetId &&
    ['allowed', 'default', 'fallback', 'execute'].includes(binding.role),
  )) return;
  throw new AuthorizationServiceError(
    AuthorizationErrors.codes.AUTHORIZATION_DENIED,
    'execution target is not bound to the requested workspace project',
    { projectId: project.id, workspaceId: input.workspaceId, executionTargetId: input.executionTargetId },
  );
}

/** Return false only for an authorization denial; surface service failures. */
export async function isWorkspaceAuthorized(
  core: Scope,
  input: {
    readonly workspaceId: string;
    readonly requestId: string;
    readonly capability: PlatformCapability;
    readonly actorId?: string;
    readonly executionTargetId?: string;
  },
): Promise<boolean> {
  try {
    await assertWorkspaceAuthorization(core, input);
    return true;
  } catch (error) {
    if (error instanceof AuthorizationServiceError && error.code === AuthorizationErrors.codes.AUTHORIZATION_DENIED) {
      return false;
    }
    throw error;
  }
}

/**
 * Resolve a session's persisted workspace and authorize access to it before a
 * route resumes the session or reads a session-scoped projection. Returning
 * `undefined` preserves the caller's normal session-not-found response; a
 * bound workspace still fails closed through `assertWorkspaceAuthorization`.
 */
export async function assertSessionAuthorization(
  core: Scope,
  input: {
    readonly sessionId: string;
    readonly requestId: string;
    readonly capability: PlatformCapability;
  },
): Promise<SessionSummary | undefined> {
  const summary = await core.accessor.get(ISessionIndex).get(input.sessionId);
  if (summary === undefined) return undefined;
  await assertWorkspaceAuthorization(core, {
    workspaceId: summary.workspaceId,
    requestId: input.requestId,
    capability: input.capability,
  });
  return summary;
}

/**
 * Return only organizations visible to the server-derived local principal.
 * Organization reads are not workspace-scoped, so they cannot use the
 * accountless unbound-workspace exception.
 */
export async function listAuthorizedOrganizations(core: Scope, actorId?: string): Promise<readonly Organization[]> {
  const governance = core.accessor.get(IPlatformGovernanceService);
  const principal = resolveLocalActorId(actorId);
  const organizations: Organization[] = [];
  for (const organization of await governance.listOrganizations()) {
    const members = await governance.listOrganizationMembers(organization.id);
    if (members.some((member) => member.member_id === principal)) organizations.push(organization);
  }
  return organizations;
}

/** Return only projects for which the local principal has `project.read`. */
export async function listAuthorizedProjects(
  core: Scope,
  organizationId?: string,
  actorId?: string,
): Promise<readonly Project[]> {
  const governance = core.accessor.get(IPlatformGovernanceService);
  const authorization = core.accessor.get(IPlatformAuthorizationService);
  const principal = resolveLocalActorId(actorId);
  const projects: Project[] = [];
  for (const project of await governance.listProjects(organizationId)) {
    const decision = await authorization.evaluate({
      request_id: authorizationRequestId(`list_projects:${project.id}`),
      actor_id: principal,
      project_id: project.id,
      capability: 'project.read',
    });
    if (decision.allowed) projects.push(project);
  }
  return projects;
}

/** Enforce organization membership for non-workspace governance reads. */
export async function assertOrganizationAuthorization(
  core: Scope,
  input: { readonly organizationId: string; readonly requestId: string; readonly actorId?: string },
): Promise<Organization | undefined> {
  const governance = core.accessor.get(IPlatformGovernanceService);
  const organization = await governance.getOrganization(input.organizationId);
  if (organization === undefined) return undefined;
  const actorId = resolveLocalActorId(input.actorId);
  const members = await governance.listOrganizationMembers(organization.id);
  if (members.some((member) => member.member_id === actorId)) return organization;
  throw new AuthorizationServiceError(
    AuthorizationErrors.codes.AUTHORIZATION_DENIED,
    'actor is not a member of the requested organization',
    { organizationId: organization.id, actorId, requestId: input.requestId },
  );
}

/** Enforce project capability access for non-workspace governance reads. */
export async function assertProjectAuthorization(
  core: Scope,
  input: {
    readonly projectId: string;
    readonly requestId: string;
    readonly capability: PlatformCapability;
    readonly workspaceId?: string;
    readonly actorId?: string;
  },
): Promise<Project | undefined> {
  const governance = core.accessor.get(IPlatformGovernanceService);
  const project = await governance.getProject(input.projectId);
  if (project === undefined) return undefined;
  await core.accessor.get(IPlatformAuthorizationService).assert({
    request_id: authorizationRequestId(input.requestId),
    actor_id: resolveLocalActorId(input.actorId),
    project_id: project.id,
    workspace_id: input.workspaceId,
    capability: input.capability,
  });
  return project;
}

function authorizationRequestId(requestId: string): string {
  return `auth_${requestId.replaceAll(/[^A-Za-z0-9._:-]/g, '_').slice(0, 240)}`;
}
