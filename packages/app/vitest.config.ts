import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Standalone vitest config (NOT the app vite.config — that carries the plugin-ESM
 * externals / inline import-map which must not affect the test runner). Pure-lib
 * suites run in `node`; component suites opt into jsdom per-file with
 * `// @vitest-environment jsdom`.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
