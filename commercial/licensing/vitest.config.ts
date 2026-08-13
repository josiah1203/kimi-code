import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'commercial-licensing',
    include: ['test/**/*.test.ts'],
  },
});
