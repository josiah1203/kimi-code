/** Workspace budget and reservation errors. */

import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';
import { Error2 } from '#/_base/errors/errors';
import type { ErrorCode } from '#/errors';

export const BudgetErrors = {
  codes: {
    BUDGET_NOT_FOUND: 'budget.not_found',
    BUDGET_RESERVATION_NOT_FOUND: 'budget.reservation_not_found',
    BUDGET_INVALID: 'budget.invalid',
    BUDGET_REQUEST_REUSED: 'budget.request_reused',
    BUDGET_BLOCKED: 'budget.blocked',
    BUDGET_APPROVAL_REQUIRED: 'budget.approval_required',
    BUDGET_SECRET_MATERIAL: 'budget.secret_material',
  },
} as const satisfies ErrorDomain;

registerErrorDomain(BudgetErrors);

export type BudgetErrorCode = (typeof BudgetErrors.codes)[keyof typeof BudgetErrors.codes];

export class BudgetServiceError extends Error2 {
  constructor(code: BudgetErrorCode, message: string, details?: Record<string, unknown>) {
    super(code as ErrorCode, message, { details });
    this.name = 'BudgetServiceError';
  }
}
