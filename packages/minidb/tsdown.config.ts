import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['./src/index.ts', './src/cluster/index.ts', './src/worker-runtime.ts'],
  format: ['esm'],
  dts: true,
  outDir: 'dist',
  clean: true,
  deps: {
    alwaysBundle: [],
    neverBundle: [],
  },
});
