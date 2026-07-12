// @ts-check
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// import.meta.dirname would need @types/node here; use the ESM-portable idiom
// the rest of the repo uses (see vitest.config.ts).
const rootDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * Flat ESLint config for the generic operator UI.
 *
 * The load-bearing rule is `@typescript-eslint/no-deprecated` (type-aware): it
 * flags any use of a `@deprecated`-tagged API at build time, so deprecations are
 * caught by the gate instead of by hand. It supersedes the now-deprecated
 * eslint-plugin-deprecation. Type info comes from the two tsconfigs (app=src,
 * test adds tests); build configs (vite/vitest/tailwind) are not app code and
 * are ignored rather than dragged into the typed program.
 *
 * `react-hooks/exhaustive-deps` is a warning, but `lint` runs `--max-warnings 0`,
 * so any unsuppressed violation fails the gate too. Intentional exceptions carry
 * an inline `eslint-disable-next-line` with a reason at the call site.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'vendor/**',
      'public/**',
      'node_modules/**',
      '*.config.js',
      '*.config.ts',
      'eslint.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Type-aware parsing for app + test sources (two tsconfigs: app=src, test=tests).
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.test.json'],
        tsconfigRootDir: rootDir,
      },
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-deprecated': 'error',
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
