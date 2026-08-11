/** Durable budget limits, reservations, and usage reconciliation. */

import { ulid } from 'ulid';
import { z } from 'zod';

import { Disposable } from '#/_base/di/lifecycle';
import { Emitter, type Event } from '#/_base/event';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { LifecycleScope } from '#/app/scopes';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import { IWorkspacePlatformEventService } from '#/workspace/platformEvents/platformEvents';
import { IWorkspacePolicyService } from '#/workspace/policy/policy';
import { findSensitivePlatformMetadataPath } from '#/workspace/platformServices/metadata';
import {
  budgetConfigureInputSchema,
  budgetReservationResultSchema,
  budgetReservationSchema,
  budgetReserveInputSchema,
  budgetReconcileInputSchema,
  budgetReleaseInputSchema,
  budgetSchema,
  budgetStatusSchema,
  budgetThresholdsSchema,
  nowIsoDateTime,
  type Budget,
  type BudgetConfigureInput,
  type BudgetReconcileInput,
  type BudgetReleaseInput,
  type BudgetReservation,
  type BudgetReservationResult,
  type BudgetReserveInput,
  type BudgetStatus,
} from '@spiderbyte/protocol';

import { BudgetErrors, BudgetServiceError } from './errors';
import { IWorkspaceBudgetService, type WorkspaceBudgetChangedEvent } from './budget';

const BUDGET_KEY = 'budgets.json';
const DOCUMENT_VERSION = 1;

const documentSchema = z.strictObject({
  version: z.literal(DOCUMENT_VERSION),
  budgets: z.array(budgetSchema),
  reservations: z.array(budgetReservationSchema),
  reserve_requests: z.record(z.string(), z.string()).default({}),
  command_requests: z.record(z.string(), z.string()).default({}),
});

type BudgetDocument = z.infer<typeof documentSchema>;

export class WorkspaceBudgetService extends Disposable implements IWorkspaceBudgetService {
  declare readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  readonly onDidChange: Event<WorkspaceBudgetChangedEvent>;

  private readonly changes = this._register(new Emitter<WorkspaceBudgetChangedEvent>());
  private readonly scope: string;
  private budgets: readonly Budget[] = [];
  private reservations: readonly BudgetReservation[] = [];
  private reserveRequests: Record<string, string> = {};
  private commandRequests: Record<string, string> = {};
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    @IAtomicDocumentStore private readonly store: IAtomicDocumentStore,
    @IWorkspaceContext private readonly context: IWorkspaceContext,
    @IWorkspacePlatformEventService private readonly events: IWorkspacePlatformEventService,
    @IWorkspacePolicyService private readonly policy: IWorkspacePolicyService,
  ) {
    super();
    this.scope = `${context.persistenceScope}/platform`;
    this.onDidChange = this.changes.event;
    this.ready = this.load();
  }

  async list(): Promise<readonly Budget[]> {
    await this.ready;
    return [...this.budgets];
  }

  async status(): Promise<BudgetStatus> {
    await this.ready;
    const budgets = this.budgets.map((budget) => refreshBudgetState(budget));
    return budgetStatusSchema.parse({
      workspace_id: this.context.workspaceId,
      budgets,
      reservations: this.reservations,
      warnings: budgets.flatMap((budget) => budgetWarnings(budget)),
      updated_at: nowIsoDateTime(),
    });
  }

  async configure(input: BudgetConfigureInput): Promise<Budget> {
    const command = budgetConfigureInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    assertValidPeriod(command.period_start, command.period_end);
    return this.enqueue(async () => {
      await this.ready;
      const existing = this.budgets.find((budget) => sameBudgetKey(budget, command));
      const budget = budgetSchema.parse({
        id: existing?.id ?? `budget_${ulid()}`,
        scope: command.scope,
        scope_id: command.scope_id,
        meter: command.meter,
        unit: command.unit,
        limit: command.limit,
        reserved: existing?.reserved ?? 0,
        consumed: existing?.consumed ?? 0,
        state: existing?.state ?? 'available',
        period_start: command.period_start,
        period_end: command.period_end,
        thresholds: budgetThresholdsSchema.parse(command.thresholds ?? {}),
        created_at: existing?.created_at ?? nowIsoDateTime(),
        updated_at: nowIsoDateTime(),
        metadata: command.metadata,
      });
      await this.replace(
        [...this.budgets.filter((candidate) => candidate.id !== budget.id), budget],
        this.reservations,
        this.reserveRequests,
        { ...this.commandRequests, [command.request_id]: budget.id },
      );
      await this.emit('configured', budget, undefined, command.request_id);
      return budget;
    });
  }

  async reserve(input: BudgetReserveInput): Promise<BudgetReservationResult> {
    const command = budgetReserveInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const mapped = this.reserveRequests[command.request_id];
      const previousReservation = mapped === undefined ? undefined : this.requireReservation(mapped);
      if (
        previousReservation !== undefined &&
        previousReservation.state !== 'approval_required' &&
        previousReservation.state !== 'blocked'
      ) return this.resultFor(previousReservation);
      if (previousReservation !== undefined && command.policy_decision_id === undefined) {
        return this.resultFor(previousReservation);
      }

      const budget = command.budget_id === undefined
        ? this.budgets.find((candidate) =>
          candidate.scope === command.scope &&
          candidate.scope_id === command.scope_id &&
          candidate.meter === command.meter &&
          candidate.unit === command.unit &&
          isActivePeriod(candidate),
        )
        : this.budgets.find((candidate) => candidate.id === command.budget_id);
      if (command.budget_id !== undefined && budget === undefined) {
        throw new BudgetServiceError(
          BudgetErrors.codes.BUDGET_NOT_FOUND,
          `budget not found: ${command.budget_id}`,
          { budgetId: command.budget_id },
        );
      }

      const now = nowIsoDateTime();
      const projected = budget === undefined
        ? 0
        : percentageOf(budget.consumed + budget.reserved + command.amount, budget.limit);
      const warnings = budget === undefined ? [] : budgetWarningsAt(budget, projected);
      let status: BudgetReservationResult['status'] = 'unbudgeted';
      let state: BudgetReservation['state'] = 'reserved';
      let reservedAmount = 0;
      if (budget !== undefined) {
        if (projected >= budget.thresholds.hard_limit_percent && command.policy_decision_id === undefined) {
          status = 'blocked';
          state = 'blocked';
        } else if (projected >= budget.thresholds.approval_percent && command.policy_decision_id === undefined) {
          status = 'approval_required';
          state = 'approval_required';
        } else {
          if (command.policy_decision_id !== undefined) {
            await this.assertBudgetDecision(command, budget.id);
          }
          status = 'reserved';
          reservedAmount = command.amount;
        }
      }
      const reservation = budgetReservationSchema.parse({
        id: previousReservation?.id ?? `reservation_${ulid()}`,
        budget_id: budget?.id ?? 'budget_unbounded',
        workspace_id: this.context.workspaceId,
        run_id: command.run_id,
        request_id: command.request_id,
        scope: command.scope,
        scope_id: command.scope_id,
        meter: command.meter,
        unit: command.unit,
        estimated_amount: command.amount,
        reserved_amount: reservedAmount,
        state,
        policy_decision_id: command.policy_decision_id,
        created_at: previousReservation?.created_at ?? now,
        updated_at: now,
        metadata: command.metadata,
      });
      const nextBudgets = budget === undefined || reservedAmount === 0
        ? this.budgets
        : this.budgets.map((candidate) => candidate.id === budget.id
          ? refreshBudgetState({ ...candidate, reserved: candidate.reserved + reservedAmount, updated_at: now })
          : candidate);
      await this.replace(
        nextBudgets,
        previousReservation === undefined
          ? [...this.reservations, reservation]
          : replaceReservation(this.reservations, reservation),
        { ...this.reserveRequests, [command.request_id]: reservation.id },
        this.commandRequests,
      );
      await this.emit('reserved', budget, reservation, command.request_id);
      return budgetReservationResultSchema.parse({ reservation, status, warnings });
    });
  }

  async release(input: BudgetReleaseInput): Promise<BudgetReservation> {
    const command = budgetReleaseInputSchema.parse(input);
    return this.enqueue(async () => {
      await this.ready;
      const reservation = this.requireReservation(command.reservation_id);
      const mapped = this.commandRequests[command.request_id];
      if (mapped !== undefined) return this.requireReservation(mapped);
      if (reservation.state === 'released' || reservation.state === 'reconciled') return reservation;
      const next = budgetReservationSchema.parse({
        ...reservation,
        reserved_amount: 0,
        state: 'released',
        updated_at: nowIsoDateTime(),
      });
      const budget = this.budgets.find((candidate) => candidate.id === reservation.budget_id);
      const nextBudgets = budget === undefined
        ? this.budgets
        : this.budgets.map((candidate) => candidate.id === budget.id
          ? refreshBudgetState({
            ...candidate,
            reserved: Math.max(0, candidate.reserved - reservation.reserved_amount),
            updated_at: next.updated_at,
          })
          : candidate);
      await this.replace(nextBudgets, replaceReservation(this.reservations, next), this.reserveRequests, {
        ...this.commandRequests,
        [command.request_id]: next.id,
      });
      await this.emit('released', budget, next, command.request_id);
      return next;
    });
  }

  async reconcile(input: BudgetReconcileInput): Promise<BudgetReservation> {
    const command = budgetReconcileInputSchema.parse(input);
    return this.enqueue(async () => {
      await this.ready;
      const reservation = this.requireReservation(command.reservation_id);
      const mapped = this.commandRequests[command.request_id];
      if (mapped !== undefined) return this.requireReservation(mapped);
      if (reservation.state === 'reconciled' || reservation.state === 'exceeded') return reservation;
      if (reservation.state !== 'reserved') {
        throw new BudgetServiceError(
          BudgetErrors.codes.BUDGET_INVALID,
          `reservation is not executable: ${reservation.id}`,
          { state: reservation.state },
        );
      }
      const next = budgetReservationSchema.parse({
        ...reservation,
        actual_amount: command.actual_amount,
        reserved_amount: 0,
        state: command.actual_amount > reservation.reserved_amount ? 'exceeded' : 'reconciled',
        updated_at: nowIsoDateTime(),
      });
      const budget = this.budgets.find((candidate) => candidate.id === reservation.budget_id);
      const nextBudgets = budget === undefined
        ? this.budgets
        : this.budgets.map((candidate) => candidate.id === budget.id
          ? refreshBudgetState({
            ...candidate,
            reserved: Math.max(0, candidate.reserved - reservation.reserved_amount),
            consumed: candidate.consumed + command.actual_amount,
            updated_at: next.updated_at,
          })
          : candidate);
      await this.replace(nextBudgets, replaceReservation(this.reservations, next), this.reserveRequests, {
        ...this.commandRequests,
        [command.request_id]: next.id,
      });
      await this.emit('reconciled', budget, next, command.request_id);
      return next;
    });
  }

  private async assertBudgetDecision(input: BudgetReserveInput, budgetId: string): Promise<void> {
    try {
      const decision = await this.policy.assertUsable(input.policy_decision_id!, {
        capability: input.meter === 'model' ? 'model' : 'cloud',
        action: `budget:${budgetId}`,
        run_id: input.run_id,
      });
      if (decision === undefined || decision.state === 'denied' || decision.outcome === 'deny') {
        throw new Error('budget policy decision was denied');
      }
    } catch (error) {
      if (error instanceof BudgetServiceError) throw error;
      throw new BudgetServiceError(
        BudgetErrors.codes.BUDGET_BLOCKED,
        'budget exception approval is not usable',
        { budgetId, policyDecisionId: input.policy_decision_id, cause: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  private requireReservation(id: string): BudgetReservation {
    const reservation = this.reservations.find((candidate) => candidate.id === id);
    if (reservation === undefined) {
      throw new BudgetServiceError(
        BudgetErrors.codes.BUDGET_RESERVATION_NOT_FOUND,
        `budget reservation not found: ${id}`,
        { reservationId: id },
      );
    }
    return reservation;
  }

  private resultFor(reservation: BudgetReservation): BudgetReservationResult {
    return budgetReservationResultSchema.parse({
      reservation,
      status: reservation.state === 'blocked'
        ? 'blocked'
        : reservation.state === 'approval_required'
          ? 'approval_required'
          : this.budgets.some((budget) => budget.id === reservation.budget_id) ? 'reserved' : 'unbudgeted',
      warnings: this.budgets.find((budget) => budget.id === reservation.budget_id)
        ? budgetWarnings(this.budgets.find((budget) => budget.id === reservation.budget_id)!)
        : [],
    });
  }

  private async emit(
    kind: WorkspaceBudgetChangedEvent['kind'],
    budget: Budget | undefined,
    reservation: BudgetReservation | undefined,
    requestId: string,
  ): Promise<void> {
    if (reservation !== undefined) this.changes.fire({ kind, budget, reservation });
    await this.events.append({
      event_type: 'workspace.updated',
      entity_type: 'workspace',
      entity_id: this.context.workspaceId,
      request_id: requestId,
      actor: 'system',
      payload: {
        budget_id: budget?.id,
        reservation_id: reservation?.id,
        state: reservation?.state ?? budget?.state,
        meter: reservation?.meter ?? budget?.meter,
      },
    });
  }

  private async load(): Promise<void> {
    const raw = await this.store.get<unknown>(this.scope, BUDGET_KEY);
    if (raw === undefined) {
      await this.replace([], [], {}, {});
      return;
    }
    const document = documentSchema.parse(raw);
    this.budgets = document.budgets;
    this.reservations = document.reservations;
    this.reserveRequests = document.reserve_requests;
    this.commandRequests = document.command_requests;
  }

  private async replace(
    budgets: readonly Budget[],
    reservations: readonly BudgetReservation[],
    reserveRequests: Record<string, string>,
    commandRequests: Record<string, string>,
  ): Promise<void> {
    const document: BudgetDocument = {
      version: DOCUMENT_VERSION,
      budgets: [...budgets],
      reservations: [...reservations],
      reserve_requests: reserveRequests,
      command_requests: commandRequests,
    };
    await this.store.set(this.scope, BUDGET_KEY, document);
    this.budgets = document.budgets;
    this.reservations = document.reservations;
    this.reserveRequests = document.reserve_requests;
    this.commandRequests = document.command_requests;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(work, work);
    this.mutationQueue = next.then(() => undefined, () => undefined);
    return next;
  }
}

function sameBudgetKey(budget: Budget, input: BudgetConfigureInput): boolean {
  return budget.scope === input.scope && budget.scope_id === input.scope_id && budget.meter === input.meter;
}

function replaceReservation(
  reservations: readonly BudgetReservation[],
  replacement: BudgetReservation,
): readonly BudgetReservation[] {
  return reservations.map((reservation) => reservation.id === replacement.id ? replacement : reservation);
}

function assertValidPeriod(start: string, end: string): void {
  if (new Date(start).getTime() >= new Date(end).getTime()) {
    throw new BudgetServiceError(BudgetErrors.codes.BUDGET_INVALID, 'budget period must end after it starts');
  }
}

function isActivePeriod(budget: Budget): boolean {
  const now = Date.now();
  return new Date(budget.period_start).getTime() <= now && new Date(budget.period_end).getTime() > now;
}

function percentageOf(value: number, limit: number): number {
  return limit === 0 ? (value === 0 ? 0 : 100) : (value / limit) * 100;
}

function refreshBudgetState(budget: Budget): Budget {
  const state = budget.consumed >= budget.limit
    ? 'exceeded'
    : budget.reserved > 0
      ? 'reserved'
      : budget.consumed > 0
        ? 'reconciled'
        : 'available';
  return budgetSchema.parse({ ...budget, state });
}

function budgetWarnings(budget: Budget): string[] {
  return budgetWarningsAt(budget, percentageOf(budget.consumed + budget.reserved, budget.limit));
}

function budgetWarningsAt(budget: Budget, projectedPercent: number): string[] {
  const warnings: string[] = [];
  if (projectedPercent >= budget.thresholds.warning_percent) warnings.push('budget is at or above the warning threshold');
  if (projectedPercent >= budget.thresholds.notification_percent) warnings.push('approver notification is recommended');
  if (projectedPercent >= budget.thresholds.approval_percent) warnings.push('new non-trivial work requires approval');
  if (projectedPercent >= budget.thresholds.hard_limit_percent) warnings.push('budget hard limit reached');
  return warnings;
}

function assertSafeMetadata(metadata: Readonly<Record<string, unknown>> | undefined): void {
  const path = findSensitivePlatformMetadataPath(metadata);
  if (path !== undefined) {
    throw new BudgetServiceError(
      BudgetErrors.codes.BUDGET_SECRET_MATERIAL,
      `budget metadata cannot contain secret material in '${path}'`,
      { key: path },
    );
  }
}

registerScopedService(
  LifecycleScope.Workspace,
  IWorkspaceBudgetService,
  WorkspaceBudgetService,
  ScopeActivation.OnScopeCreated,
  'budgets',
);
