import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'spiderbyte-telemetry',
    include: ['test/**/*.test.ts'],
  },
});
