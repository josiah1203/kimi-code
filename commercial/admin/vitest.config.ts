import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'commercial-admin',
    include: ['test/**/*.test.ts'],
  },
});
