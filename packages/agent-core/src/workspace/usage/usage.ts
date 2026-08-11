/** Workspace-local usage records and opt-in telemetry projection contract. */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type { Event } from '#/_base/event';
import type {
  UsageRecord,
  UsageRecordCreateInput,
  UsageSummary,
  UsageSummaryQuery,
} from '@spiderbyte/protocol';

export interface WorkspaceUsageChangedEvent {
  readonly usage: UsageRecord;
}

export interface IWorkspaceUsageService {
  readonly _serviceBrand: undefined;
  readonly ready: Promise<void>;
  readonly onDidChange: Event<WorkspaceUsageChangedEvent>;
  recordUsage(input: UsageRecordCreateInput): Promise<UsageRecord>;
  usageSummary(query?: UsageSummaryQuery): Promise<UsageSummary>;
}

export const IWorkspaceUsageService: ServiceIdentifier<IWorkspaceUsageService> =
  createDecorator<IWorkspaceUsageService>('workspaceUsageService');
