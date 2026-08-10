/** Accountless SpiderByte organization and project errors. */

import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';
import { Error2 } from '#/_base/errors/errors';
import type { ErrorCode } from '#/errors';

export const GovernanceErrors = {
  codes: {
    GOVERNANCE_ORGANIZATION_NOT_FOUND: 'governance.organization_not_found',
    GOVERNANCE_PROJECT_NOT_FOUND: 'governance.project_not_found',
    GOVERNANCE_MEMBERSHIP_DENIED: 'governance.membership_denied',
    GOVERNANCE_INVALID: 'governance.invalid',
    GOVERNANCE_HOSTED_IDENTITY_REQUIRED: 'governance.hosted_identity_required',
    GOVERNANCE_WORKSPACE_ALREADY_BOUND: 'governance.workspace_already_bound',
    GOVERNANCE_BINDING_NOT_FOUND: 'governance.binding_not_found',
    GOVERNANCE_BINDING_CONFLICT: 'governance.binding_conflict',
    GOVERNANCE_REQUEST_REUSED: 'governance.request_reused',
  },
} as const satisfies ErrorDomain;

registerErrorDomain(GovernanceErrors);

export type GovernanceErrorCode = (typeof GovernanceErrors.codes)[keyof typeof GovernanceErrors.codes];

export class GovernanceServiceError extends Error2 {
  constructor(code: GovernanceErrorCode, message: string, details?: Record<string, unknown>) {
    super(code as ErrorCode, message, { details });
    this.name = 'GovernanceServiceError';
  }
}
