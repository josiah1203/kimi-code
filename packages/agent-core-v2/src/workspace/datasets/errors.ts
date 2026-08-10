/** `datasets` domain — coded failures for ingestion and query execution. */

import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';
import { Error2 } from '#/_base/errors/errors';
import type { ErrorCode } from '#/errors';

export const DatasetErrors = {
  codes: {
    DATASET_NOT_FOUND: 'dataset.not_found',
    DATASET_INPUT_INVALID: 'dataset.input_invalid',
    DATASET_FORMAT_UNSUPPORTED: 'dataset.format_unsupported',
    DATASET_TOO_LARGE: 'dataset.too_large',
    DATASET_QUERY_INVALID: 'dataset.query_invalid',
    DATASET_QUERY_FAILED: 'dataset.query_failed',
    DATASET_POLICY_REQUIRED: 'dataset.policy_required',
    DATASET_SECRET_MATERIAL: 'dataset.secret_material',
  },
} as const satisfies ErrorDomain;

registerErrorDomain(DatasetErrors);

export type DatasetErrorCode = (typeof DatasetErrors.codes)[keyof typeof DatasetErrors.codes];

export class DatasetServiceError extends Error2 {
  constructor(code: DatasetErrorCode, message: string, details?: Record<string, unknown>) {
    super(code as ErrorCode, message, { details });
    this.name = 'DatasetServiceError';
  }
}
