/**
 * `policy` domain — coded failures for durable workspace policy decisions.
 */

import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';
import { Error2 } from '#/_base/errors/errors';
import type { ErrorCode } from '#/errors';

export const PolicyErrors = {
  codes: {
    POLICY_DECISION_NOT_FOUND: 'policy_decision.not_found',
    POLICY_DECISION_INVALID_STATE: 'policy_decision.invalid_state',
    POLICY_DECISION_SECRET_MATERIAL: 'policy_decision.secret_material',
  },
} as const satisfies ErrorDomain;

registerErrorDomain(PolicyErrors);

export type PolicyErrorCode = (typeof PolicyErrors.codes)[keyof typeof PolicyErrors.codes];

export class PolicyDecisionError extends Error2 {
  constructor(code: PolicyErrorCode, message: string, details?: Record<string, unknown>) {
    super(code as ErrorCode, message, { details });
    this.name = 'PolicyDecisionError';
  }
}
