/** App-scoped role and capability evaluation shared by every surface. */

import { Disposable } from '#/_base/di/lifecycle';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { LifecycleScope } from '#/app/scopes';
import {
  platformAuthorizationDecisionSchema,
  platformAuthorizationEvaluateInputSchema,
  type BusinessRole,
  type PlatformAuthorizationDecision,
  type PlatformAuthorizationEvaluateInput,
  type PlatformCapability,
} from '@moonshot-ai/protocol';

import { IPlatformGovernanceService } from '#/app/governance/governance';

import { AuthorizationErrors, AuthorizationServiceError } from './errors';
import { IPlatformAuthorizationService } from './authorization';

export class PlatformAuthorizationService extends Disposable implements IPlatformAuthorizationService {
  declare readonly _serviceBrand: undefined;

  constructor(@IPlatformGovernanceService private readonly governance: IPlatformGovernanceService) {
    super();
  }

  async evaluate(input: PlatformAuthorizationEvaluateInput): Promise<PlatformAuthorizationDecision> {
    const command = platformAuthorizationEvaluateInputSchema.parse(input);
    const project = await this.governance.getProject(command.project_id);
    if (project === undefined) {
      throw new AuthorizationServiceError(
        AuthorizationErrors.codes.AUTHORIZATION_PROJECT_NOT_FOUND,
        `project not found: ${command.project_id}`,
        { projectId: command.project_id },
      );
    }

    const roles = await this.governance.resolveProjectRoles(project.id, command.actor_id);
    const role = roleForCapability(roles, command.capability);
    const workspaceAllowed =
      command.workspace_id === undefined || project.workspace_ids.includes(command.workspace_id);
    const archived = project.state === 'archived';
    const allowed =
      workspaceAllowed &&
      roles.length > 0 &&
      role !== undefined &&
      (!archived || isReadOnlyCapability(command.capability));

    return platformAuthorizationDecisionSchema.parse({
      request_id: command.request_id,
      actor_id: command.actor_id,
      organization_id: project.organization_id,
      project_id: project.id,
      workspace_id: command.workspace_id,
      capability: command.capability,
      allowed,
      role,
      reason: reasonForDecision({
        allowed,
        archived,
        capability: command.capability,
        hasMembership: roles.length > 0,
        workspaceAllowed,
      }),
    });
  }

  async assert(input: PlatformAuthorizationEvaluateInput): Promise<PlatformAuthorizationDecision> {
    const decision = await this.evaluate(input);
    if (!decision.allowed) {
      throw new AuthorizationServiceError(
        AuthorizationErrors.codes.AUTHORIZATION_DENIED,
        decision.reason,
        { decision },
      );
    }
    return decision;
  }
}

interface DecisionFacts {
  readonly allowed: boolean;
  readonly archived: boolean;
  readonly capability: PlatformCapability;
  readonly hasMembership: boolean;
  readonly workspaceAllowed: boolean;
}

function reasonForDecision(facts: DecisionFacts): string {
  if (!facts.hasMembership) return 'actor is not a member of the organization or project';
  if (!facts.workspaceAllowed) return 'workspace is not bound to the requested project';
  if (facts.archived && !isReadOnlyCapability(facts.capability)) {
    return 'archived projects are read-only';
  }
  if (!facts.allowed) return `role does not grant capability: ${facts.capability}`;
  return 'capability granted by effective membership role';
}

function roleForCapability(
  roles: readonly BusinessRole[],
  capability: PlatformCapability,
): BusinessRole | undefined {
  return roles.find((role) => roleAllows(role, capability));
}

function roleAllows(role: BusinessRole, capability: PlatformCapability): boolean {
  if (role === 'organization_owner' || role === 'organization_administrator') return true;
  if (role === 'project_administrator') {
    return true;
  }
  if (role === 'security_policy_administrator') {
    return capability === 'policy.manage' || capability === 'audit.read';
  }
  if (role === 'billing_administrator') {
    return capability === 'usage.read' || capability === 'budget.manage' || capability === 'audit.read';
  }
  if (role === 'operator') {
    return new Set<PlatformCapability>([
      'project.read',
      'workspace.read',
      'connection.read',
      'connection.use',
      'model.select',
      'data.read',
      'data.write',
      'execution.execute',
      'run.execute',
      'usage.read',
    ]).has(capability);
  }
  if (role === 'approver') {
    return new Set<PlatformCapability>([
      'project.read',
      'workspace.read',
      'connection.read',
      'model.select',
      'data.read',
      'approval.grant',
      'usage.read',
    ]).has(capability);
  }
  if (role === 'member') {
    return new Set<PlatformCapability>([
      'project.read',
      'workspace.read',
      'connection.read',
      'connection.use',
      'model.select',
      'data.read',
      'data.write',
      'usage.read',
    ]).has(capability);
  }
  return new Set<PlatformCapability>([
    'project.read',
    'workspace.read',
    'connection.read',
    'data.read',
  ]).has(capability);
}

function isReadOnlyCapability(capability: PlatformCapability): boolean {
  return new Set<PlatformCapability>([
    'project.read',
    'workspace.read',
    'connection.read',
    'data.read',
    'usage.read',
    'audit.read',
  ]).has(capability);
}

registerScopedService(
  LifecycleScope.App,
  IPlatformAuthorizationService,
  PlatformAuthorizationService,
  ScopeActivation.OnScopeCreated,
  'authorization',
);
