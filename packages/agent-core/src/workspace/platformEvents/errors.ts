/** `platformEvents` domain — coded failures for lifecycle-event payloads. */

import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';
import { Error2 } from '#/_base/errors/errors';
import type { ErrorCode } from '#/errors';

export const PlatformEventErrors = {
  codes: {
    PLATFORM_EVENT_SECRET_MATERIAL: 'platform_event.secret_material',
  },
} as const satisfies ErrorDomain;

registerErrorDomain(PlatformEventErrors);

export type PlatformEventErrorCode =
  (typeof PlatformEventErrors.codes)[keyof typeof PlatformEventErrors.codes];

export class PlatformEventServiceError extends Error2 {
  constructor(code: PlatformEventErrorCode, message: string, details?: Record<string, unknown>) {
    super(code as ErrorCode, message, { details });
    this.name = 'PlatformEventServiceError';
  }
}
