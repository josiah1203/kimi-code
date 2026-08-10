/**
 * `automations` domain — coded failures for scheduled workspace runs.
 */

import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';
import { Error2 } from '#/_base/errors/errors';
import type { ErrorCode } from '#/errors';

export const AutomationErrors = {
  codes: {
    AUTOMATION_NOT_FOUND: 'automation.not_found',
    AUTOMATION_NAME_TAKEN: 'automation.name_taken',
    AUTOMATION_INVALID_SCHEDULE: 'automation.invalid_schedule',
    AUTOMATION_INVALID_STATE: 'automation.invalid_state',
    AUTOMATION_FIRE_NOT_FOUND: 'automation.fire_not_found',
    AUTOMATION_SESSION_NOT_FOUND: 'automation.session_not_found',
    AUTOMATION_RUN_NOT_CREATED: 'automation.run_not_created',
    AUTOMATION_PIPELINE_NOT_FOUND: 'automation.pipeline_not_found',
    AUTOMATION_PIPELINE_UNAVAILABLE: 'automation.pipeline_unavailable',
    AUTOMATION_POLICY_REQUIRED: 'automation.policy_required',
    AUTOMATION_SECRET_MATERIAL: 'automation.secret_material',
  },
} as const satisfies ErrorDomain;

registerErrorDomain(AutomationErrors);

export type AutomationErrorCode = (typeof AutomationErrors.codes)[keyof typeof AutomationErrors.codes];

export class AutomationServiceError extends Error2 {
  constructor(code: AutomationErrorCode, message: string, details?: Record<string, unknown>) {
    super(code as ErrorCode, message, { details });
    this.name = 'AutomationServiceError';
  }
}
