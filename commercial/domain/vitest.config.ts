import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'commercial-domain',
    include: ['test/**/*.test.ts'],
  },
});
