/**
 * Scenario: workspace budgets govern a durable Run reservation.
 * Responsibilities: threshold decisions, idempotency, and reconciliation are
 * exercised through IWorkspaceBudgetService with storage and policy at the
 * external boundaries.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import { IWorkspacePlatformEventService } from '#/workspace/platformEvents/platformEvents';
import { IWorkspacePolicyService } from '#/workspace/policy/policy';
import { IWorkspaceBudgetService } from '#/workspace/budgets/budget';
import { WorkspaceBudgetService } from '#/workspace/budgets/budgetService';

const context = {
  _serviceBrand: undefined,
  workspaceId: 'wd_budget_test_0123456789ab',
  cwd: '/tmp/budget-test',
  source: 'local' as const,
  meta: {
    id: 'wd_budget_test_0123456789ab',
    root: '/tmp/budget-test',
    name: 'budget-test',
    createdAt: Date.now(),
    lastOpenedAt: Date.now(),
  },
  persistenceScope: 'workspaces/wd_budget_test_0123456789ab',
  osBackendId: 'local',
  persistenceBackendId: 'local',
};

describe('WorkspaceBudgetService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let documents: Map<string, unknown>;

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    documents = new Map();
    ix.stub(IAtomicDocumentStore, {
      _serviceBrand: undefined,
      get: async (_scope: string, key: string) => documents.get(key),
      set: async (_scope: string, key: string, value: unknown) => { documents.set(key, value); },
      delete: async (_scope: string, key: string) => { documents.delete(key); },
      list: async () => [],
      watch: (() => ({ dispose: () => {} })) as never,
      acquire: () => ({ dispose: () => {} }),
    } as unknown as IAtomicDocumentStore);
    ix.stub(IWorkspaceContext, context);
    ix.stub(IWorkspacePolicyService, {
      _serviceBrand: undefined,
      assertUsable: async (id: string) => ({
        id,
        capability: 'cloud',
        outcome: 'allow',
        state: 'approved',
        reason: 'approved for test',
      }),
    } as unknown as IWorkspacePolicyService);
    ix.stub(IWorkspacePlatformEventService, {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      onDidChange: (() => ({ dispose: () => {} })) as never,
      append: async (input: unknown) => input,
      replay: async () => ({ events: [], next_sequence: 0, has_more: false }),
    } as unknown as IWorkspacePlatformEventService);
    ix.set(IWorkspaceBudgetService, new SyncDescriptor(WorkspaceBudgetService));
  });

  afterEach(() => {
    disposables.dispose();
  });

  it('returns warning and approval-required decisions at the configured thresholds', async () => {
    const service = ix.get(IWorkspaceBudgetService);
    await service.configure({
      request_id: 'budget_configure',
      actor_id: 'user_owner',
      scope: 'workspace',
      scope_id: context.workspaceId,
      meter: 'model',
      unit: 'units',
      limit: 10,
      period_start: '2026-01-01T00:00:00.000Z',
      period_end: '2027-01-01T00:00:00.000Z',
    });

    const reserved = await service.reserve({
      request_id: 'budget_reserve_50',
      actor_id: 'user_owner',
      run_id: 'run_budget',
      scope: 'workspace',
      scope_id: context.workspaceId,
      meter: 'model',
      unit: 'units',
      amount: 5,
    });
    expect(reserved.status).toBe('reserved');
    expect(reserved.warnings).toContain('budget is at or above the warning threshold');

    const approval = await service.reserve({
      request_id: 'budget_reserve_90',
      actor_id: 'user_owner',
      run_id: 'run_budget',
      scope: 'workspace',
      scope_id: context.workspaceId,
      meter: 'model',
      unit: 'units',
      amount: 4,
    });
    expect(approval.status).toBe('approval_required');
    expect(approval.reservation.state).toBe('approval_required');

    const approved = await service.reserve({
      request_id: 'budget_reserve_90',
      actor_id: 'approver',
      run_id: 'run_budget',
      scope: 'workspace',
      scope_id: context.workspaceId,
      meter: 'model',
      unit: 'units',
      amount: 4,
      policy_decision_id: 'policy_budget_approval',
    });
    expect(approved.status).toBe('reserved');
    expect(approved.reservation.id).toBe(approval.reservation.id);
  });

  it('prevents duplicate reservations and reconciles actual usage once', async () => {
    const service = ix.get(IWorkspaceBudgetService);
    await service.configure({
      request_id: 'budget_configure_idempotent',
      actor_id: 'user_owner',
      scope: 'workspace',
      scope_id: context.workspaceId,
      meter: 'execution',
      unit: 'seconds',
      limit: 100,
      period_start: '2026-01-01T00:00:00.000Z',
      period_end: '2027-01-01T00:00:00.000Z',
    });
    const input = {
      request_id: 'budget_reserve_idempotent',
      actor_id: 'user_owner',
      run_id: 'run_budget',
      scope: 'workspace' as const,
      scope_id: context.workspaceId,
      meter: 'execution' as const,
      unit: 'seconds' as const,
      amount: 10,
    };
    const first = await service.reserve(input);
    const duplicate = await service.reserve(input);
    expect(duplicate).toEqual(first);

    const reconciled = await service.reconcile({
      request_id: 'budget_reconcile',
      actor_id: 'system',
      reservation_id: first.reservation.id,
      actual_amount: 7,
    });
    expect(reconciled).toMatchObject({ state: 'reconciled', actual_amount: 7, reserved_amount: 0 });
    const status = await service.status();
    expect(status.budgets[0]).toMatchObject({ consumed: 7, reserved: 0, state: 'reconciled' });
  });

  it('uses an approved policy decision as an explicit hard-limit exception', async () => {
    const service = ix.get(IWorkspaceBudgetService);
    await service.configure({
      request_id: 'budget_configure_exception',
      actor_id: 'user_owner',
      scope: 'run',
      scope_id: 'run_budget',
      meter: 'execution',
      unit: 'units',
      limit: 1,
      period_start: '2026-01-01T00:00:00.000Z',
      period_end: '2027-01-01T00:00:00.000Z',
    });

    const result = await service.reserve({
      request_id: 'budget_reserve_exception',
      actor_id: 'approver',
      run_id: 'run_budget',
      scope: 'run',
      scope_id: 'run_budget',
      meter: 'execution',
      unit: 'units',
      amount: 1,
      policy_decision_id: 'policy_budget_exception',
    });
    expect(result.status).toBe('reserved');
    expect(result.reservation.policy_decision_id).toBe('policy_budget_exception');
  });
});
