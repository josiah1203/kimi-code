/** Coded failures for the Business plugin catalog. */

import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';
import { Error2 } from '#/_base/errors/errors';
import type { ErrorCode } from '#/errors';

export const PlatformPluginErrors = {
  codes: {
    PLATFORM_PLUGIN_NOT_FOUND: 'platform_plugin.not_found',
    PLATFORM_PLUGIN_CONFLICT: 'platform_plugin.conflict',
    PLATFORM_PLUGIN_INVALID_STATE: 'platform_plugin.invalid_state',
    PLATFORM_PLUGIN_PROJECT_MISMATCH: 'platform_plugin.project_mismatch',
  },
} as const satisfies ErrorDomain;

registerErrorDomain(PlatformPluginErrors);

export type PlatformPluginErrorCode =
  (typeof PlatformPluginErrors.codes)[keyof typeof PlatformPluginErrors.codes];

export class PlatformPluginServiceError extends Error2 {
  constructor(code: PlatformPluginErrorCode, message: string, details?: Record<string, unknown>) {
    super(code as ErrorCode, message, { details });
    this.name = 'PlatformPluginServiceError';
  }
}
