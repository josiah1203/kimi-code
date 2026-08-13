import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'commercial-hosted',
    include: ['test/**/*.test.ts'],
  },
});
