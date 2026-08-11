import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { server: 'src/index.ts' },
  format: ['esm'],
  outDir: 'dist',
  clean: true,
  external: ['@spiderbyte/agent-core', '@spiderbyte/kosong', '@spiderbyte/kaos'],
});
