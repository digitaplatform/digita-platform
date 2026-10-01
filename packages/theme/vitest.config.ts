import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // vitest's default of 5000 ms fails a test on a machine busy with other runs.
    testTimeout: 30000,
  },
});
