import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'spiderbyte-oauth',
    include: ['test/**/*.test.ts'],
  },
});
