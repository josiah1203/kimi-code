import { defineConfig } from 'tsdown';

import {
  BUILT_IN_CATALOG_DEFINE,
  builtInCatalogDefine,
} from '../../apps/cli/scripts/built-in-catalog.mjs';

export default defineConfig({
  entry: ['./src/index.ts', './src/contract.ts', './src/search/worker/runtime.ts'],
  format: ['esm'],
  dts: true,
  outDir: 'dist',
  clean: true,
  define: {
    [BUILT_IN_CATALOG_DEFINE]: builtInCatalogDefine(),
  },
  deps: {
    alwaysBundle: [/^@spiderbyte\/agent-core(?:\/|$)/, /^@spiderbyte\/oauth(?:\/|$)/],
    neverBundle: [],
  },
});
