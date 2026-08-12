import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'commercial-compute',
    include: ['test/**/*.test.ts'],
  },
});
