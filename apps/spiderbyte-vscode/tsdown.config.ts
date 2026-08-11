import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { defineConfig } from 'tsdown';

import { rawTextPlugin } from '../../build/raw-text-plugin.mjs';

const require = createRequire(import.meta.url);
const pkg = require('./package.json') as { version: string };
const root = import.meta.dirname;

export default defineConfig({
  entry: ['./src/extension.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  dts: false,
  sourcemap: false,
  plugins: [rawTextPlugin()],
  alias: {
    '@spiderbyte/sdk': resolve(root, '../../packages/sdk/src/index.ts'),
    '@spiderbyte/kaos': resolve(root, '../../packages/kaos/src/index.ts'),
    '@spiderbyte/oauth': resolve(root, '../../packages/oauth/src/index.ts'),
    '@spiderbyte/kosong': resolve(root, '../../packages/kosong/src/index.ts'),
  },
  define: {
    __EXTENSION_VERSION__: JSON.stringify(pkg.version),
  },
  banner: {
    js: [
      "import { fileURLToPath as __cjsShimFileURLToPath } from 'node:url';",
      "import { dirname as __cjsShimDirname } from 'node:path';",
      'const __filename = __cjsShimFileURLToPath(import.meta.url);',
      'const __dirname = __cjsShimDirname(__filename);',
    ].join('\n'),
  },
  deps: {
    onlyBundle: false,
    alwaysBundle: [/^@spiderbyte-ai\//, 'zod'],
    neverBundle: ['vscode'],
  },
  outputOptions: {
    entryFileNames: 'extension.js',
  },
});
