import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'commercial-enterprise',
    include: ['test/**/*.test.ts'],
  },
});
