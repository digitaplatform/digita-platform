import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  SHARED_EXTERNALS,
  ENTRY_FILES,
  SPECIFIER_TO_ENTRY,
} from '../vendor/shared-externals.mjs';

/**
 * The plugin-ESM federation contract: vite's externals, the vendor entries, and
 * the import-map keys must agree, or the host + runtime-loaded plugins end up with
 * separate React/ReactDOM instances. A drift here caused the deployed "react-dom
 * does not provide an export named 'createPortal'" crash. These guard it.
 */
const vendorDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'entries');

describe('vendor shared-externals contract', () => {
  it('externals exactly match the import-map specifiers', () => {
    expect([...SHARED_EXTERNALS].sort()).toEqual(Object.keys(SPECIFIER_TO_ENTRY).sort());
  });

  it('every import-map specifier maps to a known entry', () => {
    for (const entry of Object.values(SPECIFIER_TO_ENTRY)) {
      expect(ENTRY_FILES, `entry "${entry}" missing from ENTRY_FILES`).toHaveProperty(entry);
    }
  });

  it('every entry source file exists on disk', () => {
    for (const [name, file] of Object.entries(ENTRY_FILES)) {
      expect(existsSync(join(vendorDir, file)), `entry "${name}" file ${file} not found`).toBe(true);
    }
  });

  it('react-dom entry explicitly re-exports the named CJS surface (createPortal/flushSync)', () => {
    // react-dom is CJS; `export * from 'react-dom'` drops named exports through
    // esbuild interop. The entry MUST destructure them explicitly — regression guard.
    const src = readFileSync(join(vendorDir, ENTRY_FILES['react-dom']), 'utf-8');
    expect(src).toMatch(/createPortal/);
    expect(src).toMatch(/flushSync/);
    expect(src).toMatch(/export const \{/);
  });
});
