/** Durable local usage records for Open Core provider and execution events. */

import { ulid } from 'ulid';
import { z } from 'zod';

import { Disposable } from '#/_base/di/lifecycle';
import { Emitter, type Event } from '#/_base/event';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { LifecycleScope } from '#/app/scopes';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import { IWorkspacePlatformEventService } from '#/workspace/platformEvents/platformEvents';
import {
  nowIsoDateTime,
  usageRecordCreateInputSchema,
  usageRecordSchema,
  usageSummaryQuerySchema,
  usageSummarySchema,
  type UsageRecord,
  type UsageRecordCreateInput,
  type UsageSummary,
  type UsageSummaryQuery,
} from '@moonshot-ai/protocol';

import { findSensitivePlatformMetadataPath } from '#/workspace/platformServices/metadata';
import { WorkspaceUsageErrors, WorkspaceUsageServiceError } from './errors';
import { IWorkspaceUsageService, type WorkspaceUsageChangedEvent } from './usage';

const USAGE_KEY = 'usage.json';
const DOCUMENT_VERSION = 1;

const documentSchema = z.strictObject({
  version: z.literal(DOCUMENT_VERSION),
  usage: z.array(usageRecordSchema),
  requests: z.record(z.string(), z.string()).default({}),
});

type UsageDocument = z.infer<typeof documentSchema>;

export class WorkspaceUsageService extends Disposable implements IWorkspaceUsageService {
  declare readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  readonly onDidChange: Event<WorkspaceUsageChangedEvent>;

  private readonly changes = this._register(new Emitter<WorkspaceUsageChangedEvent>());
  private readonly scope: string;
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

  async recordUsage(input: UsageRecordCreateInput): Promise<UsageRecord> {
    const command = usageRecordCreateInputSchema.parse(input);
    validateUsageUnit(command);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.requireUsage(mapped);
      const { request_id: _requestId, actor_id: actorId, ...usageInput } = command;
      const record = usageRecordSchema.parse({
        ...usageInput,
        id: `usage_${ulid()}`,
        workspace_id: this.context.workspaceId,
        recorded_at: nowIsoDateTime(),
        metadata: { ...command.metadata, recorded_by: actorId },
      });
      await this.replace([...this.usage, record], {
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
      this.changes.fire({ usage: record });
      return record;
    });
  }

  async usageSummary(query: UsageSummaryQuery = {}): Promise<UsageSummary> {
    const parsed = usageSummaryQuerySchema.parse(query);
    await this.ready;
    const end = parsed.period_end ?? nowIsoDateTime();
    const start =
      parsed.period_start ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
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
      managed_llm_units: sumMeter(records, 'managed_llm'),
      managed_compute_seconds: sumMeter(records, 'managed_compute'),
      artifact_storage_units: sumMeter(records, 'artifact_storage'),
      plugin_usage_units: sumMeter(records, 'plugin_usage'),
      record_count: records.length,
    });
  }

  private requireUsage(id: string): UsageRecord {
    const record = this.usage.find((candidate) => candidate.id === id);
    if (record === undefined) {
      throw new WorkspaceUsageServiceError(
        WorkspaceUsageErrors.codes.WORKSPACE_USAGE_NOT_FOUND,
        `usage record not found: ${id}`,
        { id },
      );
    }
    return record;
  }

  private async load(): Promise<void> {
    const raw = await this.store.get<unknown>(this.scope, USAGE_KEY);
    if (raw === undefined) {
      await this.replace([], {});
      return;
    }
    const document = documentSchema.parse(raw);
    this.usage = document.usage;
    this.requests = document.requests;
  }

  private async replace(usage: readonly UsageRecord[], requests: Record<string, string>): Promise<void> {
    const document: UsageDocument = { version: DOCUMENT_VERSION, usage: [...usage], requests };
    await this.store.set(this.scope, USAGE_KEY, document);
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

function validateUsageUnit(input: UsageRecordCreateInput): void {
  if (input.meter === 'intelligence' && input.unit !== 'intelligence_percent') {
    throw new WorkspaceUsageServiceError(
      WorkspaceUsageErrors.codes.WORKSPACE_USAGE_INVALID,
      'intelligence usage must use intelligence_percent',
    );
  }
  if ((input.meter === 'hosted_execution' || input.meter === 'customer_cloud_execution' || input.meter === 'managed_compute') && input.unit !== 'seconds') {
    throw new WorkspaceUsageServiceError(
      WorkspaceUsageErrors.codes.WORKSPACE_USAGE_INVALID,
      'execution usage must use seconds',
    );
  }
  if ((input.meter === 'managed_llm' || input.meter === 'artifact_storage' || input.meter === 'plugin_usage') && input.unit !== 'units' && input.unit !== 'usd') {
    throw new WorkspaceUsageServiceError(
      WorkspaceUsageErrors.codes.WORKSPACE_USAGE_INVALID,
      'managed LLM, storage, and plugin usage must use units or usd',
    );
  }
}

function assertSafeMetadata(metadata: Readonly<Record<string, unknown>> | undefined): void {
  const path = findSensitivePlatformMetadataPath(metadata);
  if (path !== undefined) {
    throw new WorkspaceUsageServiceError(
      WorkspaceUsageErrors.codes.WORKSPACE_USAGE_SECRET_MATERIAL,
      `usage metadata cannot contain secret material in '${path}'`,
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
  IWorkspaceUsageService,
  WorkspaceUsageService,
  ScopeActivation.OnScopeCreated,
  'workspaceUsage',
);
