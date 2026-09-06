import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Deep-nesting parser walks (e.g. AVIF meta recursion) run orders of
    // magnitude slower under coverage instrumentation; 30s mirrors the
    // generous bound those tests assert. Cold GitHub runners spike far
    // past vitest's 5s default.
    testTimeout: 30000,
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'tests/**/*.test.ts', 'mod.test.ts'],
    coverage: {
      include: ['src/**', 'mod.ts'],
      reporter: ['lcov', 'text'],
    },
  },
});
