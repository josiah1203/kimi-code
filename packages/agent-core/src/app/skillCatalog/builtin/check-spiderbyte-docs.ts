/**
 * `skillCatalog` domain — builtin `check-spiderbyte-docs` skill definition.
 */

import type { SkillDefinition } from '#/app/skillCatalog/types';
import { parseSkillText } from '#/app/skillCatalog/parser';
import CHECK_SPIDERBYTE_DOCS_BODY from './check-spiderbyte-docs.md?raw';

const PSEUDO_PATH = 'builtin://check-spiderbyte-docs';

const parsed = parseSkillText({
  skillMdPath: '/builtin/skills/check-spiderbyte-docs.md',
  skillDirName: 'check-spiderbyte-docs',
  source: 'builtin',
  text: CHECK_SPIDERBYTE_DOCS_BODY,
});

export const CHECK_SPIDERBYTE_DOCS_SKILL: SkillDefinition = {
  ...parsed,
  path: PSEUDO_PATH,
  dir: PSEUDO_PATH,
  metadata: {
    ...parsed.metadata,
    type: parsed.metadata.type ?? 'inline',
  },
  productSpecific: true,
};
