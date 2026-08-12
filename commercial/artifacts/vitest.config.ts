import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'commercial-artifacts',
    include: ['test/**/*.test.ts'],
  },
});
