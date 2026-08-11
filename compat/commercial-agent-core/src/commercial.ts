/** Workspace membership, entitlement, and customer-facing usage contracts. */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type { Event } from '#/_base/event';
import type {
  UsageRecord,
  UsageRecordCreateInput,
  UsageSummary,
  UsageSummaryQuery,
  WorkspaceEntitlement,
  WorkspaceEntitlementUpdateInput,
  WorkspaceMember,
  WorkspaceMemberUpsertInput,
} from '@spiderbyte/protocol';

export interface WorkspaceCommercialChangedEvent {
  readonly kind: 'member_changed' | 'entitlement_changed' | 'usage_recorded';
  readonly member?: WorkspaceMember;
  readonly entitlement?: WorkspaceEntitlement;
  readonly usage?: UsageRecord;
}

export interface IWorkspaceCommercialService {
  readonly _serviceBrand: undefined;
  readonly ready: Promise<void>;
  readonly onDidChange: Event<WorkspaceCommercialChangedEvent>;
  listMembers(): Promise<readonly WorkspaceMember[]>;
  upsertMember(input: WorkspaceMemberUpsertInput): Promise<WorkspaceMember>;
  listEntitlements(): Promise<readonly WorkspaceEntitlement[]>;
  setEntitlement(input: WorkspaceEntitlementUpdateInput): Promise<WorkspaceEntitlement>;
  recordUsage(input: UsageRecordCreateInput): Promise<UsageRecord>;
  usageSummary(query?: UsageSummaryQuery): Promise<UsageSummary>;
}

export const IWorkspaceCommercialService: ServiceIdentifier<IWorkspaceCommercialService> =
  createDecorator<IWorkspaceCommercialService>('commercialService');
