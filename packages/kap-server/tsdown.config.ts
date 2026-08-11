import { defineConfig } from 'tsdown';

import {
  BUILT_IN_CATALOG_DEFINE,
  builtInCatalogDefine,
} from '../../apps/cli/scripts/built-in-catalog.mjs';
import { rawTextPlugin } from '../../build/raw-text-plugin.mjs';

export default defineConfig({
  entry: ['./src/index.ts', './src/contract.ts', './src/search/worker/runtime.ts'],
  format: ['esm'],
  dts: false,
  outDir: 'dist',
  clean: true,
  define: {
    [BUILT_IN_CATALOG_DEFINE]: builtInCatalogDefine(),
  },
  plugins: [rawTextPlugin()],
  deps: {
    alwaysBundle: [/^@spiderbyte\/agent-core(?:\/|$)/, /^@spiderbyte\/oauth(?:\/|$)/],
    neverBundle: [],
  },
});
