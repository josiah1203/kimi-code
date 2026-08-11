import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@spiderbyte\/agent-core$/,
        replacement: fileURLToPath(new URL('../agent-core/src/index.ts', import.meta.url)),
      },
      {
        find: /^@spiderbyte\/agent-core\/(.+)$/,
        replacement: `${fileURLToPath(new URL('../agent-core/src/', import.meta.url))}$1`,
      },
      {
        find: /^@spiderbyte\/oauth$/,
        replacement: fileURLToPath(new URL('../oauth/src/index.ts', import.meta.url)),
      },
      {
        find: /^@spiderbyte\/oauth\/(.+)$/,
        replacement: `${fileURLToPath(new URL('../oauth/src/', import.meta.url))}$1`,
      },
    ],
  },
  test: {
    name: 'spiderbyte-sdk',
    env: {
      SPIDERBYTE_DISABLE_FS_WATCH: '1',
      SPIDERBYTE_LOG_LEVEL: 'off',
    },
    include: ['test/**/*.test.ts'],
  },
});
