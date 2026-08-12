export const CommercialArtifactCodes = {
  ARTIFACT_NOT_FOUND: 'commercial.artifact.not_found',
  ARTIFACT_HELD: 'commercial.artifact.legal_hold',
  ARTIFACT_DELETED: 'commercial.artifact.deleted',
  STORAGE_QUOTA_EXCEEDED: 'commercial.artifact.storage_quota_exceeded',
  RETENTION_POLICY_NOT_FOUND: 'commercial.artifact.retention_policy_not_found',
  IDEMPOTENCY_REUSED: 'commercial.artifact.idempotency_reused',
} as const;

export class CommercialArtifactError extends Error {
  readonly code: string;
  readonly detail: Record<string, unknown> | undefined;

  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'CommercialArtifactError';
    this.code = code;
    this.detail = detail;
  }
}
