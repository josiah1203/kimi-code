/** Durable workspace membership, entitlement, and non-token usage projections. */

import { ulid } from 'ulid';
import { z } from 'zod';

import { Disposable } from '#/_base/di/lifecycle';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { Emitter, type Event } from '#/_base/event';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import { IWorkspacePlatformEventService } from '#/workspace/platformEvents/platformEvents';
import {
  nowIsoDateTime,
  usageRecordCreateInputSchema,
  usageRecordSchema,
  usageSummaryQuerySchema,
  usageSummarySchema,
  workspaceEntitlementSchema,
  workspaceEntitlementUpdateInputSchema,
  workspaceMemberSchema,
  workspaceMemberUpsertInputSchema,
  type UsageRecord,
  type UsageRecordCreateInput,
  type UsageSummary,
  type UsageSummaryQuery,
  type WorkspaceEntitlement,
  type WorkspaceEntitlementUpdateInput,
  type WorkspaceMember,
  type WorkspaceMemberRole,
  type WorkspaceMemberUpsertInput,
} from '@moonshot-ai/protocol';

import { IWorkspaceCommercialService, type WorkspaceCommercialChangedEvent } from './commercial';
import { CommercialErrors, CommercialServiceError } from './errors';
import { findSensitivePlatformMetadataPath } from '#/workspace/platformServices/metadata';

const COMMERCIAL_KEY = 'commercial.json';
const DOCUMENT_VERSION = 1;

const documentSchema = z.strictObject({
  version: z.literal(DOCUMENT_VERSION),
  members: z.array(workspaceMemberSchema),
  entitlements: z.array(workspaceEntitlementSchema),
  usage: z.array(usageRecordSchema),
  requests: z.record(z.string(), z.string()).default({}),
});

type CommercialDocument = z.infer<typeof documentSchema>;

export class WorkspaceCommercialService extends Disposable implements IWorkspaceCommercialService {
  declare readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  readonly onDidChange: Event<WorkspaceCommercialChangedEvent>;

  private readonly changes = this._register(new Emitter<WorkspaceCommercialChangedEvent>());
  private readonly scope: string;
  private members: readonly WorkspaceMember[] = [];
  private entitlements: readonly WorkspaceEntitlement[] = [];
  private usage: readonly UsageRecord[] = [];
  private requests: Record<string, string> = {};
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    @IAtomicDocumentStore private readonly store: IAtomicDocumentStore,
    @IWorkspaceContext private readonly context: IWorkspaceContext,
    @IWorkspacePlatformEventService private readonly events: IWorkspacePlatformEventService,
  ) {
    super();
    this.scope = `${context.persistenceScope}/platform`;
    this.onDidChange = this.changes.event;
    this.ready = this.load();
  }

  async listMembers(): Promise<readonly WorkspaceMember[]> {
    await this.ready;
    return [...this.members];
  }

  async upsertMember(input: WorkspaceMemberUpsertInput): Promise<WorkspaceMember> {
    const command = workspaceMemberUpsertInputSchema.parse(input);
    return this.enqueue(async () => {
      await this.ready;
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.requireMember(mapped);
      const actor = this.members.find((member) => member.member_id === command.actor_id);
      if (this.members.length > 0 && actor === undefined) {
        throw new CommercialServiceError(
          CommercialErrors.codes.COMMERCIAL_MEMBERSHIP_DENIED,
          'workspace membership change requires an existing member',
        );
      }
      if (actor !== undefined && !canManageMembership(actor.role, command.role)) {
        throw new CommercialServiceError(
          CommercialErrors.codes.COMMERCIAL_MEMBERSHIP_DENIED,
          `member with role '${actor.role}' cannot grant '${command.role}'`,
          { actor_role: actor.role, target_role: command.role },
        );
      }
      const existing = this.members.find((member) => member.member_id === command.member_id);
      if (existing?.role === 'owner' && command.role !== 'owner' && this.countOwners() === 1) {
        throw new CommercialServiceError(
          CommercialErrors.codes.COMMERCIAL_OWNER_REQUIRED,
          'workspace must retain an owner',
        );
      }
      if (command.role === 'owner' && actor !== undefined && actor.role !== 'owner') {
        throw new CommercialServiceError(
          CommercialErrors.codes.COMMERCIAL_MEMBERSHIP_DENIED,
          'only an owner can grant the owner role',
        );
      }
      const member = workspaceMemberSchema.parse({
        workspace_id: this.context.workspaceId,
        member_id: command.member_id,
        role: this.members.length === 0 ? 'owner' : command.role,
        joined_at: existing?.joined_at ?? nowIsoDateTime(),
      });
      await this.replace(
        [...this.members.filter((candidate) => candidate.member_id !== member.member_id), member],
        this.entitlements,
        this.usage,
        { ...this.requests, [command.request_id]: member.member_id },
      );
      await this.events.append({
        event_type: 'workspace.updated',
        entity_type: 'workspace',
        entity_id: this.context.workspaceId,
        request_id: command.request_id,
        actor: 'user',
        payload: { member_id: member.member_id, role: member.role },
      });
      this.changes.fire({ kind: 'member_changed', member });
      return member;
    });
  }

  async listEntitlements(): Promise<readonly WorkspaceEntitlement[]> {
    await this.ready;
    return [...this.entitlements];
  }

  async setEntitlement(input: WorkspaceEntitlementUpdateInput): Promise<WorkspaceEntitlement> {
    const command = workspaceEntitlementUpdateInputSchema.parse(input);
    return this.enqueue(async () => {
      await this.ready;
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) {
        const existing = this.entitlements.find((entitlement) => entitlement.key === mapped);
        if (existing !== undefined) return existing;
        throw new CommercialServiceError(
          CommercialErrors.codes.COMMERCIAL_ENTITLEMENT_NOT_FOUND,
          `entitlement not found: ${mapped}`,
          { key: mapped },
        );
      }
      const actor = this.members.find((member) => member.member_id === command.actor_id);
      if (actor === undefined || (actor.role !== 'owner' && actor.role !== 'admin')) {
        throw new CommercialServiceError(
          CommercialErrors.codes.COMMERCIAL_MEMBERSHIP_DENIED,
          'entitlement changes require an owner or admin',
        );
      }
      const existing = this.entitlements.find((entitlement) => entitlement.key === command.key);
      const entitlement = workspaceEntitlementSchema.parse({
        workspace_id: this.context.workspaceId,
        key: command.key,
        enabled: command.enabled,
        limit: command.limit,
        unit: command.unit,
        updated_at: nowIsoDateTime(),
      });
      await this.replace(
        this.members,
        [...this.entitlements.filter((candidate) => candidate.key !== entitlement.key), entitlement],
        this.usage,
        { ...this.requests, [command.request_id]: existing?.key ?? entitlement.key },
      );
      await this.events.append({
        event_type: 'workspace.updated',
        entity_type: 'workspace',
        entity_id: this.context.workspaceId,
        request_id: command.request_id,
        actor: 'user',
        payload: { entitlement: entitlement.key, enabled: entitlement.enabled },
      });
      this.changes.fire({ kind: 'entitlement_changed', entitlement });
      return entitlement;
    });
  }

  async recordUsage(input: UsageRecordCreateInput): Promise<UsageRecord> {
    const command = usageRecordCreateInputSchema.parse(input);
    validateUsageUnit(command);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.requireUsage(mapped);
      const meterKey = `usage_${command.meter}`;
      const entitlement = this.entitlements.find((candidate) => candidate.key === meterKey);
      const existingAmount = this.usage
        .filter((record) => record.meter === command.meter)
        .reduce((sum, record) => sum + record.amount, 0);
      if (entitlement?.enabled === false) {
        throw new CommercialServiceError(
          CommercialErrors.codes.COMMERCIAL_ENTITLEMENT_DISABLED,
          `usage meter is disabled: ${command.meter}`,
          { meter: command.meter },
        );
      }
      if (entitlement?.limit !== undefined && existingAmount + command.amount > entitlement.limit) {
        throw new CommercialServiceError(
          CommercialErrors.codes.COMMERCIAL_ENTITLEMENT_EXCEEDED,
          `usage entitlement exceeded: ${command.meter}`,
          { meter: command.meter, limit: entitlement.limit },
        );
      }
      const { request_id: _requestId, actor_id: actorId, ...usageInput } = command;
      const record = usageRecordSchema.parse({
        ...usageInput,
        id: `usage_${ulid()}`,
        workspace_id: this.context.workspaceId,
        recorded_at: nowIsoDateTime(),
        metadata: { ...command.metadata, recorded_by: actorId },
      });
      await this.replace(this.members, this.entitlements, [...this.usage, record], {
        ...this.requests,
        [command.request_id]: record.id,
      });
      await this.events.append({
        event_type: 'usage_record.created',
        entity_type: 'usage_record',
        entity_id: record.id,
        request_id: command.request_id,
        actor: 'system',
        payload: { meter: record.meter, unit: record.unit, amount: record.amount },
      });
      this.changes.fire({ kind: 'usage_recorded', usage: record });
      return record;
    });
  }

  async usageSummary(query: UsageSummaryQuery = {}): Promise<UsageSummary> {
    const parsed = usageSummaryQuerySchema.parse(query);
    await this.ready;
    const end = parsed.period_end ?? nowIsoDateTime();
    const start = parsed.period_start ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const records = this.usage.filter((record) => {
      const time = new Date(record.recorded_at).getTime();
      return time >= new Date(start).getTime() && time <= new Date(end).getTime();
    });
    return usageSummarySchema.parse({
      workspace_id: this.context.workspaceId,
      period_start: start,
      period_end: end,
      intelligence_percent: sumMeter(records, 'intelligence'),
      hosted_execution_seconds: sumMeter(records, 'hosted_execution'),
      customer_cloud_execution_seconds: sumMeter(records, 'customer_cloud_execution'),
      record_count: records.length,
    });
  }

  private countOwners(): number {
    return this.members.filter((member) => member.role === 'owner').length;
  }

  private requireMember(memberId: string): WorkspaceMember {
    const member = this.members.find((candidate) => candidate.member_id === memberId);
    if (member === undefined) {
      throw new CommercialServiceError(
        CommercialErrors.codes.COMMERCIAL_MEMBER_NOT_FOUND,
        `workspace member not found: ${memberId}`,
        { member_id: memberId },
      );
    }
    return member;
  }

  private requireUsage(id: string): UsageRecord {
    const record = this.usage.find((candidate) => candidate.id === id);
    if (record === undefined) {
      throw new CommercialServiceError(
        CommercialErrors.codes.COMMERCIAL_USAGE_NOT_FOUND,
        `usage record not found: ${id}`,
        { id },
      );
    }
    return record;
  }

  private async load(): Promise<void> {
    const raw = await this.store.get<unknown>(this.scope, COMMERCIAL_KEY);
    if (raw === undefined) {
      await this.replace([], [], [], {});
      return;
    }
    const document = documentSchema.parse(raw);
    this.members = document.members;
    this.entitlements = document.entitlements;
    this.usage = document.usage;
    this.requests = document.requests;
  }

  private async replace(
    members: readonly WorkspaceMember[],
    entitlements: readonly WorkspaceEntitlement[],
    usage: readonly UsageRecord[],
    requests: Record<string, string>,
  ): Promise<void> {
    const document: CommercialDocument = {
      version: DOCUMENT_VERSION,
      members: [...members],
      entitlements: [...entitlements],
      usage: [...usage],
      requests,
    };
    await this.store.set(this.scope, COMMERCIAL_KEY, document);
    this.members = document.members;
    this.entitlements = document.entitlements;
    this.usage = document.usage;
    this.requests = document.requests;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(work, work);
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

function canManageMembership(role: WorkspaceMemberRole, targetRole: WorkspaceMemberRole): boolean {
  if (role === 'owner') return true;
  if (role === 'admin') return targetRole !== 'owner';
  return false;
}

function validateUsageUnit(input: UsageRecordCreateInput): void {
  if (input.meter === 'intelligence' && input.unit !== 'intelligence_percent') {
    throw new CommercialServiceError(
      CommercialErrors.codes.COMMERCIAL_USAGE_INVALID,
      'intelligence usage must use intelligence_percent',
    );
  }
  if (input.meter !== 'intelligence' && input.unit !== 'seconds') {
    throw new CommercialServiceError(
      CommercialErrors.codes.COMMERCIAL_USAGE_INVALID,
      'execution usage must use seconds',
    );
  }
}

function assertSafeMetadata(metadata: Readonly<Record<string, unknown>> | undefined): void {
  const path = findSensitivePlatformMetadataPath(metadata);
  if (path !== undefined) {
    throw new CommercialServiceError(
      CommercialErrors.codes.COMMERCIAL_SECRET_MATERIAL,
      `commercial usage metadata cannot contain secret material in '${path}'`,
      { key: path },
    );
  }
}

function sumMeter(records: readonly UsageRecord[], meter: UsageRecord['meter']): number {
  return records
    .filter((record) => record.meter === meter)
    .reduce((sum, record) => sum + record.amount, 0);
}

registerScopedService(
  LifecycleScope.Workspace,
  IWorkspaceCommercialService,
  WorkspaceCommercialService,
  ScopeActivation.OnScopeCreated,
  'commercial',
);
