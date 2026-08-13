/** Durable accountless organization, project, membership, and workspace bindings. */

import { ulid } from 'ulid';
import { z } from 'zod';

import { Disposable } from '#/_base/di/lifecycle';
import { Emitter, type Event } from '#/_base/event';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { LifecycleScope } from '#/app/scopes';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import {
  nowIsoDateTime,
  organizationCreateInputSchema,
  organizationMemberSchema,
  organizationMemberUpsertInputSchema,
  organizationSchema,
  projectCreateInputSchema,
  projectBindingCreateInputSchema,
  projectBindingRemoveInputSchema,
  projectBindingSchema,
  projectMemberSchema,
  projectMemberUpsertInputSchema,
  projectSchema,
  projectWorkspaceBindInputSchema,
  type BusinessRole,
  type Organization,
  type OrganizationCreateInput,
  type OrganizationMember,
  type OrganizationMemberUpsertInput,
  type Project,
  type ProjectBinding,
  type ProjectBindingCreateInput,
  type ProjectBindingRemoveInput,
  type ProjectCreateInput,
  type ProjectMember,
  type ProjectMemberUpsertInput,
  type ProjectWorkspaceBindInput,
} from '@spiderbyte/protocol';

import { GovernanceErrors, GovernanceServiceError } from './errors';
import { IPlatformGovernanceService, type GovernanceChangedEvent } from './governance';

const GOVERNANCE_KEY = 'spiderbyte-governance.json';
const DOCUMENT_VERSION = 1;
const LOCAL_ORGANIZATION_NAME = 'Local SpiderByte';
const LOCAL_ACTOR = 'local-user';

const documentSchema = z.strictObject({
  version: z.literal(DOCUMENT_VERSION),
  organizations: z.array(organizationSchema),
  organization_members: z.array(organizationMemberSchema),
  projects: z.array(projectSchema),
  project_members: z.array(projectMemberSchema),
  project_bindings: z.array(projectBindingSchema).default([]),
  requests: z.record(z.string(), z.string()).default({}),
});

type GovernanceDocument = z.infer<typeof documentSchema>;

export class PlatformGovernanceService extends Disposable implements IPlatformGovernanceService {
  declare readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  readonly onDidChange: Event<GovernanceChangedEvent>;

  private readonly changes = this._register(new Emitter<GovernanceChangedEvent>());
  private readonly scope: string;
  private organizations: readonly Organization[] = [];
  private organizationMembers: readonly OrganizationMember[] = [];
  private projects: readonly Project[] = [];
  private projectMembers: readonly ProjectMember[] = [];
  private projectBindings: readonly ProjectBinding[] = [];
  private requests: Record<string, string> = {};
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    @IAtomicDocumentStore private readonly store: IAtomicDocumentStore,
    @IBootstrapService bootstrap: IBootstrapService,
  ) {
    super();
    this.scope = `${bootstrap.scope('store')}/platform`;
    this.onDidChange = this.changes.event;
    this.ready = this.load();
  }

  async listOrganizations(): Promise<readonly Organization[]> {
    await this.ready;
    return [...this.organizations];
  }

  async getOrganization(id: string): Promise<Organization | undefined> {
    await this.ready;
    return this.organizations.find((organization) => organization.id === id);
  }

  async listOrganizationMembers(id: string): Promise<readonly OrganizationMember[]> {
    await this.ready;
    this.requireOrganization(id);
    return this.organizationMembers.filter((member) => member.organization_id === id);
  }

  async createOrganization(input: OrganizationCreateInput): Promise<Organization> {
    const command = organizationCreateInputSchema.parse(input);
    return this.enqueue(async () => {
      await this.ready;
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.requireOrganization(mapped);
      const now = nowIsoDateTime();
      const organization = organizationSchema.parse({
        id: `org_${ulid()}`,
        name: command.name,
        mode: command.mode,
        created_at: now,
        updated_at: now,
        metadata: command.metadata,
      });
      const member = organizationMemberSchema.parse({
        organization_id: organization.id,
        member_id: command.actor_id,
        role: 'organization_owner',
        joined_at: now,
      });
      await this.replace(
        [...this.organizations, organization],
        [...this.organizationMembers, member],
        this.projects,
        this.projectMembers,
        this.projectBindings,
        { ...this.requests, [command.request_id]: organization.id },
      );
      this.changes.fire({ kind: 'organization_created', organization });
      this.changes.fire({ kind: 'organization_member_changed', organization_member: member });
      return organization;
    });
  }

  async upsertOrganizationMember(input: OrganizationMemberUpsertInput): Promise<OrganizationMember> {
    const command = organizationMemberUpsertInputSchema.parse(input);
    return this.enqueue(async () => {
      await this.ready;
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.requireOrganizationMember(command.organization_id, mapped);
      this.requireOrganization(command.organization_id);
      this.assertOrganizationAdmin(command.organization_id, command.actor_id);
      const existing = this.organizationMembers.find((member) =>
        member.organization_id === command.organization_id && member.member_id === command.member_id,
      );
      if (existing?.role === 'organization_owner' && command.role !== 'organization_owner') {
        const ownerCount = this.organizationMembers.filter((member) =>
          member.organization_id === command.organization_id && member.role === 'organization_owner',
        ).length;
        if (ownerCount === 1) throw new GovernanceServiceError(
          GovernanceErrors.codes.GOVERNANCE_INVALID,
          'organization must retain an owner',
        );
      }
      const member = organizationMemberSchema.parse({
        organization_id: command.organization_id,
        member_id: command.member_id,
        role: command.role,
        joined_at: existing?.joined_at ?? nowIsoDateTime(),
      });
      await this.replace(
        this.organizations,
        [...this.organizationMembers.filter((candidate) => !(candidate.organization_id === member.organization_id && candidate.member_id === member.member_id)), member],
        this.projects,
        this.projectMembers,
        this.projectBindings,
        { ...this.requests, [command.request_id]: member.member_id },
      );
      this.changes.fire({ kind: 'organization_member_changed', organization_member: member });
      return member;
    });
  }

  async listProjects(organizationId?: string): Promise<readonly Project[]> {
    await this.ready;
    if (organizationId === undefined) return [...this.projects];
    return this.projects.filter((project) => project.organization_id === organizationId);
  }

  async getProject(id: string): Promise<Project | undefined> {
    await this.ready;
    return this.projects.find((project) => project.id === id);
  }

  async listProjectMembers(id: string): Promise<readonly ProjectMember[]> {
    await this.ready;
    this.requireProject(id);
    return this.projectMembers.filter((member) => member.project_id === id);
  }

  async createProject(input: ProjectCreateInput): Promise<Project> {
    const command = projectCreateInputSchema.parse(input);
    return this.enqueue(async () => {
      await this.ready;
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.requireProject(mapped);
      this.requireOrganization(command.organization_id);
      this.assertOrganizationAdmin(command.organization_id, command.actor_id);
      const now = nowIsoDateTime();
      const project = projectSchema.parse({
        id: `project_${ulid()}`,
        organization_id: command.organization_id,
        name: command.name,
        state: 'active',
        workspace_ids: [],
        created_at: now,
        updated_at: now,
        metadata: command.metadata,
      });
      const member = projectMemberSchema.parse({
        project_id: project.id,
        member_id: command.actor_id,
        role: 'project_administrator',
        joined_at: now,
      });
      await this.replace(
        this.organizations,
        this.organizationMembers,
        [...this.projects, project],
        [...this.projectMembers, member],
        this.projectBindings,
        { ...this.requests, [command.request_id]: project.id },
      );
      this.changes.fire({ kind: 'project_created', project });
      this.changes.fire({ kind: 'project_member_changed', project_member: member });
      return project;
    });
  }

  async upsertProjectMember(input: ProjectMemberUpsertInput): Promise<ProjectMember> {
    const command = projectMemberUpsertInputSchema.parse(input);
    return this.enqueue(async () => {
      await this.ready;
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.requireProjectMember(command.project_id, mapped);
      const project = this.requireProject(command.project_id);
      this.assertProjectAdmin(project, command.actor_id);
      const existing = this.projectMembers.find((member) =>
        member.project_id === command.project_id && member.member_id === command.member_id,
      );
      const member = projectMemberSchema.parse({
        project_id: command.project_id,
        member_id: command.member_id,
        role: command.role,
        joined_at: existing?.joined_at ?? nowIsoDateTime(),
      });
      await this.replace(
        this.organizations,
        this.organizationMembers,
        this.projects,
        [...this.projectMembers.filter((candidate) => !(candidate.project_id === member.project_id && candidate.member_id === member.member_id)), member],
        this.projectBindings,
        { ...this.requests, [command.request_id]: member.member_id },
      );
      this.changes.fire({ kind: 'project_member_changed', project_member: member });
      return member;
    });
  }

  async bindWorkspace(projectId: string, input: ProjectWorkspaceBindInput): Promise<Project> {
    const command = projectWorkspaceBindInputSchema.parse(input);
    return this.enqueue(async () => {
      await this.ready;
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.requireProject(mapped);
      const project = this.requireProject(projectId);
      this.assertProjectAdmin(project, command.actor_id);
      const existingProject = this.projects.find((candidate) =>
        candidate.id !== project.id && candidate.workspace_ids.includes(command.workspace_id),
      );
      if (existingProject !== undefined) {
        throw new GovernanceServiceError(
          GovernanceErrors.codes.GOVERNANCE_WORKSPACE_ALREADY_BOUND,
          `workspace is already bound to project: ${existingProject.id}`,
          { workspaceId: command.workspace_id, projectId: existingProject.id },
        );
      }
      const next = projectSchema.parse({
        ...project,
        workspace_ids: [...new Set([...project.workspace_ids, command.workspace_id])],
        updated_at: nowIsoDateTime(),
      });
      await this.replace(
        this.organizations,
        this.organizationMembers,
        this.projects.map((candidate) => candidate.id === project.id ? next : candidate),
        this.projectMembers,
        this.projectBindings,
        { ...this.requests, [command.request_id]: next.id },
      );
      this.changes.fire({ kind: 'workspace_bound', project: next });
      return next;
    });
  }

  async projectForWorkspace(workspaceId: string): Promise<Project | undefined> {
    await this.ready;
    return this.projects.find((project) => project.workspace_ids.includes(workspaceId));
  }

  async listProjectBindings(projectId: string, workspaceId?: string): Promise<readonly ProjectBinding[]> {
    await this.ready;
    this.requireProject(projectId);
    return this.projectBindings.filter((binding) =>
      binding.project_id === projectId &&
      (workspaceId === undefined || binding.workspace_id === workspaceId),
    );
  }

  async bindProjectResource(input: ProjectBindingCreateInput): Promise<ProjectBinding> {
    const command = projectBindingCreateInputSchema.parse(input);
    return this.enqueue(async () => {
      await this.ready;
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.requireProjectBinding(mapped);
      const project = this.requireProject(command.project_id);
      this.assertProjectAdmin(project, command.actor_id);
      if (
        command.workspace_id !== undefined &&
        !project.workspace_ids.includes(command.workspace_id)
      ) {
        throw new GovernanceServiceError(
          GovernanceErrors.codes.GOVERNANCE_INVALID,
          `workspace is not bound to project: ${command.workspace_id}`,
          { projectId: project.id, workspaceId: command.workspace_id },
        );
      }
      const duplicate = this.projectBindings.find((binding) =>
        binding.project_id === command.project_id &&
        binding.workspace_id === command.workspace_id &&
        binding.kind === command.kind &&
        binding.resource_id === command.resource_id &&
        binding.role === command.role &&
        binding.state === 'active',
      );
      if (duplicate !== undefined) return duplicate;
      const singletonConflict = this.projectBindings.find((binding) =>
        binding.project_id === command.project_id &&
        binding.workspace_id === command.workspace_id &&
        binding.kind === command.kind &&
        binding.role === command.role &&
        binding.state === 'active' &&
        (command.role === 'default' || command.role === 'fallback'),
      );
      if (singletonConflict !== undefined) {
        throw new GovernanceServiceError(
          GovernanceErrors.codes.GOVERNANCE_BINDING_CONFLICT,
          `an active ${command.role} ${command.kind} binding already exists`,
          { projectId: project.id, bindingId: singletonConflict.id },
        );
      }
      const now = nowIsoDateTime();
      const binding = projectBindingSchema.parse({
        id: `binding_${ulid()}`,
        project_id: project.id,
        workspace_id: command.workspace_id,
        kind: command.kind,
        resource_id: command.resource_id,
        role: command.role,
        state: 'active',
        created_at: now,
        updated_at: now,
      });
      await this.replace(
        this.organizations,
        this.organizationMembers,
        this.projects,
        this.projectMembers,
        [...this.projectBindings, binding],
        { ...this.requests, [command.request_id]: binding.id },
      );
      this.changes.fire({ kind: 'project_binding_changed', project_binding: binding });
      return binding;
    });
  }

  async removeProjectBinding(input: ProjectBindingRemoveInput): Promise<ProjectBinding> {
    const command = projectBindingRemoveInputSchema.parse(input);
    return this.enqueue(async () => {
      await this.ready;
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.requireProjectBinding(mapped);
      const project = this.requireProject(command.project_id);
      this.assertProjectAdmin(project, command.actor_id);
      const binding = this.requireProjectBinding(command.binding_id);
      if (binding.project_id !== project.id) {
        throw new GovernanceServiceError(
          GovernanceErrors.codes.GOVERNANCE_BINDING_NOT_FOUND,
          `project binding not found: ${command.binding_id}`,
          { projectId: project.id, bindingId: command.binding_id },
        );
      }
      const next = projectBindingSchema.parse({
        ...binding,
        state: 'disabled',
        updated_at: nowIsoDateTime(),
      });
      await this.replace(
        this.organizations,
        this.organizationMembers,
        this.projects,
        this.projectMembers,
        this.projectBindings.map((candidate) => candidate.id === next.id ? next : candidate),
        { ...this.requests, [command.request_id]: next.id },
      );
      this.changes.fire({ kind: 'project_binding_changed', project_binding: next });
      return next;
    });
  }

  async resolveProjectRoles(projectId: string, actorId: string): Promise<readonly BusinessRole[]> {
    await this.ready;
    const project = this.requireProject(projectId);
    const projectMember = this.projectMembers.find((member) =>
      member.project_id === project.id && member.member_id === actorId,
    );
    const organizationMember = this.organizationMembers.find((member) =>
      member.organization_id === project.organization_id && member.member_id === actorId,
    );
    return [organizationMember?.role, projectMember?.role].filter(
      (role): role is BusinessRole => role !== undefined,
    );
  }

  async ensureLocalOrganization(actorId = LOCAL_ACTOR): Promise<Organization> {
    await this.ready;
    const existing = this.organizations.find((organization) => organization.mode === 'local');
    if (existing !== undefined) {
      const member = this.organizationMembers.find((candidate) =>
        candidate.organization_id === existing.id && candidate.member_id === actorId,
      );
      if (member === undefined) {
        throw new GovernanceServiceError(
          GovernanceErrors.codes.GOVERNANCE_MEMBERSHIP_DENIED,
          'local organization is not available to this actor',
        );
      }
      return existing;
    }
    return this.createOrganization({
      request_id: 'governance:ensure-local',
      actor_id: actorId,
      name: LOCAL_ORGANIZATION_NAME,
      mode: 'local',
    });
  }

  private assertOrganizationAdmin(organizationId: string, actorId: string): void {
    const member = this.organizationMembers.find((candidate) =>
      candidate.organization_id === organizationId && candidate.member_id === actorId,
    );
    if (member === undefined || !isOrganizationAdmin(member.role)) {
      throw new GovernanceServiceError(
        GovernanceErrors.codes.GOVERNANCE_MEMBERSHIP_DENIED,
        'organization administration requires an organization owner or administrator',
      );
    }
  }

  private assertProjectAdmin(project: Project, actorId: string): void {
    const projectMember = this.projectMembers.find((member) =>
      member.project_id === project.id && member.member_id === actorId,
    );
    const organizationMember = this.organizationMembers.find((member) =>
      member.organization_id === project.organization_id && member.member_id === actorId,
    );
    if (
      (projectMember === undefined || !isProjectAdmin(projectMember.role)) &&
      (organizationMember === undefined || !isOrganizationAdmin(organizationMember.role))
    ) {
      throw new GovernanceServiceError(
        GovernanceErrors.codes.GOVERNANCE_MEMBERSHIP_DENIED,
        'project administration requires project administrator or organization administration access',
      );
    }
  }

  private requireOrganization(id: string): Organization {
    const organization = this.organizations.find((candidate) => candidate.id === id);
    if (organization === undefined) throw new GovernanceServiceError(
      GovernanceErrors.codes.GOVERNANCE_ORGANIZATION_NOT_FOUND,
      `organization not found: ${id}`,
      { organizationId: id },
    );
    return organization;
  }

  private requireOrganizationMember(organizationId: string, memberId: string): OrganizationMember {
    const member = this.organizationMembers.find((candidate) =>
      candidate.organization_id === organizationId && candidate.member_id === memberId,
    );
    if (member === undefined) throw new GovernanceServiceError(
      GovernanceErrors.codes.GOVERNANCE_MEMBERSHIP_DENIED,
      `organization member not found: ${memberId}`,
    );
    return member;
  }

  private requireProject(id: string): Project {
    const project = this.projects.find((candidate) => candidate.id === id);
    if (project === undefined) throw new GovernanceServiceError(
      GovernanceErrors.codes.GOVERNANCE_PROJECT_NOT_FOUND,
      `project not found: ${id}`,
      { projectId: id },
    );
    return project;
  }

  private requireProjectMember(projectId: string, memberId: string): ProjectMember {
    const member = this.projectMembers.find((candidate) =>
      candidate.project_id === projectId && candidate.member_id === memberId,
    );
    if (member === undefined) throw new GovernanceServiceError(
      GovernanceErrors.codes.GOVERNANCE_MEMBERSHIP_DENIED,
      `project member not found: ${memberId}`,
    );
    return member;
  }

  private async load(): Promise<void> {
    const raw = await this.store.get<unknown>(this.scope, GOVERNANCE_KEY);
    if (raw === undefined) {
      // Do not create an empty control-plane document during App activation.
      // A host may dispose a freshly created local engine before the first
      // governance mutation; deferring the write avoids an orphaned async
      // persistence task racing that teardown.
      this.organizations = [];
      this.organizationMembers = [];
      this.projects = [];
      this.projectMembers = [];
      this.projectBindings = [];
      this.requests = {};
      return;
    }
    const document = documentSchema.parse(raw);
    this.organizations = document.organizations;
    this.organizationMembers = document.organization_members;
    this.projects = document.projects;
    this.projectMembers = document.project_members;
    this.projectBindings = document.project_bindings;
    this.requests = document.requests;
  }

  private async replace(
    organizations: readonly Organization[],
    organizationMembers: readonly OrganizationMember[],
    projects: readonly Project[],
    projectMembers: readonly ProjectMember[],
    projectBindings: readonly ProjectBinding[],
    requests: Record<string, string>,
  ): Promise<void> {
    const document: GovernanceDocument = {
      version: DOCUMENT_VERSION,
      organizations: [...organizations],
      organization_members: [...organizationMembers],
      projects: [...projects],
      project_members: [...projectMembers],
      project_bindings: [...projectBindings],
      requests,
    };
    await this.store.set(this.scope, GOVERNANCE_KEY, document);
    this.organizations = document.organizations;
    this.organizationMembers = document.organization_members;
    this.projects = document.projects;
    this.projectMembers = document.project_members;
    this.projectBindings = document.project_bindings;
    this.requests = document.requests;
  }

  private requireProjectBinding(id: string): ProjectBinding {
    const binding = this.projectBindings.find((candidate) => candidate.id === id);
    if (binding === undefined) {
      throw new GovernanceServiceError(
        GovernanceErrors.codes.GOVERNANCE_BINDING_NOT_FOUND,
        `project binding not found: ${id}`,
        { bindingId: id },
      );
    }
    return binding;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(work, work);
    this.mutationQueue = next.then(() => undefined, () => undefined);
    return next;
  }
}

function isOrganizationAdmin(role: BusinessRole): boolean {
  return role === 'organization_owner' || role === 'organization_administrator';
}

function isProjectAdmin(role: BusinessRole): boolean {
  return role === 'project_administrator' || isOrganizationAdmin(role);
}

registerScopedService(
  LifecycleScope.App,
  IPlatformGovernanceService,
  PlatformGovernanceService,
  ScopeActivation.OnScopeCreated,
  'governance',
);
