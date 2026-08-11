/** SpiderByte organization → project → workspace control-plane contract. */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type { Event } from '#/_base/event';
import type {
  Organization,
  OrganizationCreateInput,
  OrganizationMember,
  OrganizationMemberUpsertInput,
  Project,
  ProjectBinding,
  ProjectBindingCreateInput,
  ProjectBindingRemoveInput,
  ProjectCreateInput,
  ProjectMember,
  ProjectMemberUpsertInput,
  ProjectWorkspaceBindInput,
  BusinessRole,
} from '@spiderbyte/protocol';

export interface GovernanceChangedEvent {
  readonly kind:
    | 'organization_created'
    | 'organization_member_changed'
    | 'project_created'
    | 'project_member_changed'
    | 'workspace_bound'
    | 'project_binding_changed';
  readonly organization?: Organization;
  readonly organization_member?: OrganizationMember;
  readonly project?: Project;
  readonly project_member?: ProjectMember;
  readonly project_binding?: ProjectBinding;
}

export interface IPlatformGovernanceService {
  readonly _serviceBrand: undefined;
  readonly ready: Promise<void>;
  readonly onDidChange: Event<GovernanceChangedEvent>;
  listOrganizations(): Promise<readonly Organization[]>;
  getOrganization(id: string): Promise<Organization | undefined>;
  listOrganizationMembers(id: string): Promise<readonly OrganizationMember[]>;
  createOrganization(input: OrganizationCreateInput): Promise<Organization>;
  upsertOrganizationMember(input: OrganizationMemberUpsertInput): Promise<OrganizationMember>;
  listProjects(organizationId?: string): Promise<readonly Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  listProjectMembers(id: string): Promise<readonly ProjectMember[]>;
  createProject(input: ProjectCreateInput): Promise<Project>;
  upsertProjectMember(input: ProjectMemberUpsertInput): Promise<ProjectMember>;
  bindWorkspace(projectId: string, input: ProjectWorkspaceBindInput): Promise<Project>;
  projectForWorkspace(workspaceId: string): Promise<Project | undefined>;
  listProjectBindings(projectId: string, workspaceId?: string): Promise<readonly ProjectBinding[]>;
  bindProjectResource(input: ProjectBindingCreateInput): Promise<ProjectBinding>;
  removeProjectBinding(input: ProjectBindingRemoveInput): Promise<ProjectBinding>;
  resolveProjectRoles(projectId: string, actorId: string): Promise<readonly BusinessRole[]>;
  ensureLocalOrganization(actorId?: string): Promise<Organization>;
}

export const IPlatformGovernanceService: ServiceIdentifier<IPlatformGovernanceService> =
  createDecorator<IPlatformGovernanceService>('platformGovernanceService');
