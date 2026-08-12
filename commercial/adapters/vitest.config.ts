import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'commercial-adapters',
    include: ['test/**/*.test.ts'],
  },
});
