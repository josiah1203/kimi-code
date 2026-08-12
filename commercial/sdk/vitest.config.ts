import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'commercial-sdk',
    include: ['test/**/*.test.ts'],
  },
});
