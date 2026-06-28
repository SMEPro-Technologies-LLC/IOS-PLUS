import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only pick up test files under packages/*/src — exclude compiled dist/ output
    include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.spec.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    environment: 'node',
  },
});
