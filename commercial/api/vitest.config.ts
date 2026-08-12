import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'commercial-api',
    include: ['test/**/*.test.ts'],
  },
});
