import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: './src/index.ts',
  format: ['esm'],
  dts: true,
  outDir: 'dist',
  clean: true,
  deps: { neverBundle: ['@spiderbyte/commercial-api', '@spiderbyte/commercial-domain'] },
});
