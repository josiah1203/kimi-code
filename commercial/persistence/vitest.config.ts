import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'commercial-persistence',
    include: ['test/**/*.test.ts'],
  },
});
