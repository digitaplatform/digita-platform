/* eslint-disable @typescript-eslint/no-explicit-any */
// Make the @testing-library/jest-dom matchers visible to `tsc` (pnpm typecheck),
// not just to the vitest runtime. tests/setup.ts loads them at runtime via
// `import '@testing-library/jest-dom/vitest'`, but that node_modules side-effect
// import is not reliably picked up by the type checker under `types: ["node"]`.
// This first-party ambient module — always part of the test program (tests/ is in
// tsconfig.test.json's include) — mirrors jest-dom's own augmentation so
// expect(...).toBeInTheDocument() & co. are typed on vitest's Assertion.
import 'vitest';
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'vitest' {
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}
