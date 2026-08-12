export class CommercialSdkError extends Error {
  readonly code: string;
  readonly status: number | undefined;
  readonly detail: Record<string, unknown> | undefined;

  constructor(code: string, message: string, status?: number, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'CommercialSdkError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}
