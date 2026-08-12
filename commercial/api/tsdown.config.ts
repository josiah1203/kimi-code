import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['./src/index.ts'],
  format: ['esm'],
  dts: true,
  outDir: 'dist',
  clean: true,
  deps: {
    neverBundle: [
      '@spiderbyte/commercial-admin',
      '@spiderbyte/commercial-application',
      '@spiderbyte/commercial-artifacts',
      '@spiderbyte/commercial-domain',
      '@spiderbyte/commercial-compute',
      '@spiderbyte/commercial-enterprise',
      '@spiderbyte/commercial-ports',
      'fastify',
      'ws',
    ],
  },
});
