import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'commercial-application',
    include: ['test/**/*.test.ts'],
  },
});
