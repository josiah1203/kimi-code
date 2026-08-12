import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'commercial-ports',
    include: ['test/**/*.test.ts'],
  },
});
