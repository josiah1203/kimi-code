/**
 * `kosongConfig` domain — models.dev import error codes.
 *
 * The edge server branches on these codes to map them onto its numeric
 * protocol envelope, so the code strings are part of the wire contract.
 */

import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';

export const ModelsDevImportErrors = {
  codes: {
    CATALOG_UNAVAILABLE: 'modelsDev.catalog_unavailable',
    CATALOG_ENTRY_NOT_FOUND: 'modelsDev.catalog_entry_not_found',
    CATALOG_IMPORT_INVALID: 'modelsDev.import_invalid',
    REGISTRY_IMPORT_INVALID: 'modelsDev.registry_import_invalid',
    PROVIDER_OAUTH_UNSUPPORTED: 'provider.oauth_unsupported',
  },
  info: {
    'modelsDev.catalog_unavailable': {
      title: 'models.dev directory unavailable',
      retryable: true,
      public: true,
      action: 'Check the network connection to models.dev and try again.',
    },
    'modelsDev.catalog_entry_not_found': {
      title: 'Directory entry not found',
      retryable: false,
      public: true,
      action: 'Check the catalog id against the models.dev directory listing.',
    },
    'modelsDev.import_invalid': {
      title: 'Directory entry not importable',
      retryable: false,
      public: true,
      action: 'Pick another entry or supply the required base_url.',
    },
    'modelsDev.registry_import_invalid': {
      title: 'Custom registry not importable',
      retryable: false,
      public: true,
      action: 'Check the registry URL and credentials.',
    },
    'provider.oauth_unsupported': {
      title: 'Provider OAuth is not supported in Open Core',
      retryable: false,
      public: true,
      action: 'Configure the provider with a local or BYOK adapter instead.',
    },
  },
} as const satisfies ErrorDomain;

registerErrorDomain(ModelsDevImportErrors);
