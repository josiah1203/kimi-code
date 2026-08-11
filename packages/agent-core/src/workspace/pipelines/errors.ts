/**
 * `pipelines` domain — coded failures from durable pipeline definition and
 * execution operations.
 */

import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';
import { Error2 } from '#/_base/errors/errors';
import type { ErrorCode } from '#/errors';

export const PipelineErrors = {
  codes: {
    PIPELINE_NOT_FOUND: 'pipeline.not_found',
    PIPELINE_INVALID_INPUT: 'pipeline.invalid_input',
    PIPELINE_INVALID_STATE: 'pipeline.invalid_state',
    PIPELINE_NAME_TAKEN: 'pipeline.name_taken',
    PIPELINE_CYCLE: 'pipeline.cycle',
    PIPELINE_POLICY_REQUIRED: 'pipeline.policy_required',
    PIPELINE_EXECUTION_FAILED: 'pipeline.execution_failed',
    PIPELINE_SECRET_MATERIAL: 'pipeline.secret_material',
  },
} as const satisfies ErrorDomain;

registerErrorDomain(PipelineErrors);

export type PipelineErrorCode = (typeof PipelineErrors.codes)[keyof typeof PipelineErrors.codes];

export class PipelineServiceError extends Error2 {
  constructor(code: PipelineErrorCode, message: string, details?: Record<string, unknown>) {
    super(code as ErrorCode, message, { details });
    this.name = 'PipelineServiceError';
  }
}
