/** Workspace-scoped budget and reservation service contract. */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type { Event } from '#/_base/event';
import type {
  Budget,
  BudgetConfigureInput,
  BudgetReconcileInput,
  BudgetReleaseInput,
  BudgetReservation,
  BudgetReservationResult,
  BudgetReserveInput,
  BudgetStatus,
} from '@moonshot-ai/protocol';

export interface WorkspaceBudgetChangedEvent {
  readonly kind: 'configured' | 'reserved' | 'released' | 'reconciled';
  readonly budget?: Budget;
  readonly reservation: BudgetReservation;
}

export interface IWorkspaceBudgetService {
  readonly _serviceBrand: undefined;
  readonly ready: Promise<void>;
  readonly onDidChange: Event<WorkspaceBudgetChangedEvent>;
  list(): Promise<readonly Budget[]>;
  status(): Promise<BudgetStatus>;
  configure(input: BudgetConfigureInput): Promise<Budget>;
  reserve(input: BudgetReserveInput): Promise<BudgetReservationResult>;
  release(input: BudgetReleaseInput): Promise<BudgetReservation>;
  reconcile(input: BudgetReconcileInput): Promise<BudgetReservation>;
}

export const IWorkspaceBudgetService: ServiceIdentifier<IWorkspaceBudgetService> =
  createDecorator<IWorkspaceBudgetService>('workspaceBudgetService');
