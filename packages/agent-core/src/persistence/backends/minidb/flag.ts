/**
 * `minidb` persistence backend — flag contribution.
 *
 * Gates the minidb-backed derived read-model (`IQueryStore`) and the consumers
 * that read through it. On by default; roll back to the legacy authoritative
 * read path via `SPIDERBYTE_EXPERIMENTAL_PERSISTENCE_MINIDB_READMODEL=false` or
 * the `[experimental]` config section.
 */

import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const persistenceMiniDbReadModelFlag: FlagDefinitionInput = {
  id: 'persistence_minidb_readmodel',
  title: 'minidb read model',
  description:
    'Use the minidb-backed IQueryStore as a derived read model for session indexing and wire replay.',
  env: 'SPIDERBYTE_EXPERIMENTAL_PERSISTENCE_MINIDB_READMODEL',
  default: true,
  surface: 'core',
};

registerFlagDefinition(persistenceMiniDbReadModelFlag);
