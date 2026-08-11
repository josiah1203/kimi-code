/**
 * `auth` domain error codes.
 */

import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';

export const AuthErrors = {
  codes: {
    AUTH_LOGIN_REQUIRED: 'auth.login_required',
    AUTH_PROVISIONING_REQUIRED: 'auth.provisioning_required',
    AUTH_TOKEN_MISSING: 'auth.token_missing',
    AUTH_TOKEN_UNAUTHORIZED: 'auth.token_unauthorized',
    AUTH_MODEL_NOT_RESOLVED: 'auth.model_not_resolved',
  },
  info: {
    'auth.login_required': {
      title: 'Login required',
      retryable: false,
      public: true,
      action: 'Configure a local or BYOK provider before starting a run.',
    },
    'auth.provisioning_required': {
      title: 'Provider provisioning required',
      retryable: false,
      public: true,
      action: 'Configure a local or BYOK provider before starting a run.',
    },
    'auth.token_missing': {
      title: 'Provider credential missing',
      retryable: false,
      public: true,
      action: 'Configure an API key or an explicitly supported provider credential.',
    },
    'auth.token_unauthorized': {
      title: 'Provider credential unauthorized',
      retryable: false,
      public: true,
      action: 'Check the configured provider credential and endpoint.',
    },
    'auth.model_not_resolved': {
      title: 'Model not resolved',
      retryable: false,
      public: true,
      action: 'Set a default model or configure the requested model alias.',
    },
  },
} as const satisfies ErrorDomain;

registerErrorDomain(AuthErrors);
