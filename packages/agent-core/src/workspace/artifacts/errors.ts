/**
 * `artifacts` domain — coded failures for content-addressed workspace artifacts.
 */

import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';
import { Error2 } from '#/_base/errors/errors';
import type { ErrorCode } from '#/errors';

export const ArtifactErrors = {
  codes: {
    ARTIFACT_NOT_FOUND: 'artifact.not_found',
    ARTIFACT_MISSING_HASH: 'artifact.missing_hash',
    ARTIFACT_INVALID_CONTENT: 'artifact.invalid_content',
    ARTIFACT_EXPIRED: 'artifact.expired',
    ARTIFACT_SECRET_MATERIAL: 'artifact.secret_material',
  },
} as const satisfies ErrorDomain;

registerErrorDomain(ArtifactErrors);

export type ArtifactErrorCode = (typeof ArtifactErrors.codes)[keyof typeof ArtifactErrors.codes];

export class ArtifactServiceError extends Error2 {
  constructor(code: ArtifactErrorCode, message: string, details?: Record<string, unknown>) {
    super(code as ErrorCode, message, { details });
    this.name = 'ArtifactServiceError';
  }
}
