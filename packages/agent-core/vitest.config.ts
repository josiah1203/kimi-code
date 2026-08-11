import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'SpiderByte Agent Core',
    include: ['test/**/*.{test,e2e,integration}.ts'],
    setupFiles: ['test/setup.ts'],
  },
});
