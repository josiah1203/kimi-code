export const CommercialComputeCodes = {
  PROVIDER_NOT_FOUND: 'commercial.compute.provider_not_found',
  PROVIDER_UNAVAILABLE: 'commercial.compute.provider_unavailable',
  REGION_NOT_FOUND: 'commercial.compute.region_not_found',
  JOB_CLASS_NOT_FOUND: 'commercial.compute.job_class_not_found',
  INVALID_LIFECYCLE: 'commercial.compute.invalid_lifecycle',
  EXECUTION_NOT_FOUND: 'commercial.compute.execution_not_found',
  RESERVATION_NOT_FOUND: 'commercial.compute.reservation_not_found',
  AUTHORIZATION_REQUIRED: 'commercial.compute.authorization_required',
  IDEMPOTENCY_REUSED: 'commercial.compute.idempotency_reused',
} as const;

export class CommercialComputeError extends Error {
  readonly code: string;
  readonly detail: Record<string, unknown> | undefined;

  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'CommercialComputeError';
    this.code = code;
    this.detail = detail;
  }
}
