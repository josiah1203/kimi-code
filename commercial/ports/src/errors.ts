import type { CapabilityStatus } from '@spiderbyte/commercial-domain';

export class CommercialPortError extends Error {
  readonly code: string;
  readonly detail: Record<string, unknown> | undefined;

  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'CommercialPortError';
    this.code = code;
    this.detail = detail;
  }
}

export class CapabilityUnavailableError extends CommercialPortError {
  readonly status: CapabilityStatus;

  constructor(status: CapabilityStatus) {
    super(
      `commercial.${status.capability}.${status.availability}`,
      status.reason,
      { capability: status.capability, availability: status.availability, adapter: status.adapter },
    );
    this.name = 'CapabilityUnavailableError';
    this.status = status;
  }
}
