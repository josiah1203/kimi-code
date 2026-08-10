/** Agent-scoped conversational projection over the session Run authority. */

import { Disposable } from '#/_base/di/lifecycle';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { Emitter, type Event } from '#/_base/event';
import { ISessionRunService } from '#/session/run/run';
import type { Run } from '@moonshot-ai/protocol';

import {
  conversationalRunAlias,
  IPlatformConversationService,
  isConversationalPlatformRun,
  type PlatformConversationRunChangedEvent,
} from './platformConversation';

export class PlatformConversationService
  extends Disposable
  implements IPlatformConversationService
{
  declare readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  readonly onDidChange: Event<PlatformConversationRunChangedEvent>;

  private readonly changes = this._register(new Emitter<PlatformConversationRunChangedEvent>());
  private currentRun: Run | undefined;
  private rootRun: Run | undefined;

  constructor(@ISessionRunService private readonly runs: ISessionRunService) {
    super();
    this.onDidChange = this.changes.event;
    this._register(this.runs.onDidChange((run) => this.accept(run)));
    this.ready = this.load();
  }

  async current(): Promise<Run | undefined> {
    await this.ready;
    return this.currentRun;
  }

  async root(): Promise<Run | undefined> {
    await this.ready;
    return this.rootRun;
  }

  async resolveRunReference(reference?: string): Promise<Run | undefined> {
    await this.ready;
    const normalized = reference?.trim();
    if (normalized === undefined || normalized.length === 0 || conversationalRunAlias(normalized)) {
      return this.currentRun;
    }
    return this.runs.get(normalized);
  }

  async resolveDatasetReference(reference?: string): Promise<string | undefined> {
    await this.ready;
    const normalized = reference?.trim();
    if (normalized === undefined || normalized.length === 0) return undefined;
    if (!conversationalRunAlias(normalized)) return normalized;

    const runs = await this.runs.list();
    const candidates = runs
      .filter(isConversationalPlatformRun)
      .toSorted((left, right) => compareRuns(right, left));
    for (const run of candidates) {
      const direct = stringValue(run.metadata?.['dataset_id']);
      if (direct !== undefined) return direct;
      const descriptor = run.metadata?.['platform_operation'];
      if (!isRecord(descriptor) || !isRecord(descriptor['input'])) continue;
      const datasetId = stringValue(descriptor['input']['dataset_id']);
      if (datasetId !== undefined) return datasetId;
    }
    return undefined;
  }

  private async load(): Promise<void> {
    await this.runs.ready;
    const runs = await this.runs.list();
    for (const run of runs) this.accept(run, false);
  }

  private accept(run: Run, emit = true): void {
    if (!isConversationalPlatformRun(run)) return;
    if (isConversationalRootRun(run)) {
      if (this.rootRun === undefined || compareRuns(run, this.rootRun) >= 0) this.rootRun = run;
    }
    const previous = this.currentRun;
    if (previous !== undefined && compareRuns(run, previous) < 0) return;
    this.currentRun = run;
    if (emit && (previous === undefined || previous.id !== run.id || previous.updated_at !== run.updated_at)) {
      this.changes.fire({ run, previous });
    }
  }
}

function compareRuns(left: Run, right: Run): number {
  const timestamp = left.updated_at.localeCompare(right.updated_at);
  return timestamp !== 0 ? timestamp : left.id.localeCompare(right.id);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isConversationalRootRun(run: Run): boolean {
  return run.parent_run_id === undefined && run.metadata?.['kind'] === 'conversation';
}

registerScopedService(
  LifecycleScope.Agent,
  IPlatformConversationService,
  PlatformConversationService,
  ScopeActivation.OnDemand,
  'platformConversation',
);
