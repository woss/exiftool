import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'tests/**/*.test.ts', 'mod.test.ts'],
    coverage: {
      include: ['src/**', 'mod.ts'],
      reporter: ['lcov', 'text'],
    },
  },
});
