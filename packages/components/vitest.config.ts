import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    // vitest's default of 5000 ms fails a test on a machine busy with other runs.
    testTimeout: 30000,
  },
});
