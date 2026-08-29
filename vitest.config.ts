import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'tests/**/*.test.ts', 'mod.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**', 'cli.ts', 'mod.ts'],
      reporter: ['lcov', 'text'],
    },
  },
});
