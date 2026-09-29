import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The label on a primary fill is the tint-derived text-onPrimary (#89): a literal white is 2.41:1 on
// the digita cyan and 4.02:1 on the default blue. The components package keeps the same rule.
const ROOTS = [join(__dirname, '../src'), join(__dirname, '../../components/src')];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx|ts)$/.test(name) ? [path] : [];
  });
}

/** Class strings that fill with the primary ramp and label with a literal white. */
function literalWhiteOnPrimary(text: string): string[] {
  return [...text.matchAll(/["'`][^"'`]*\bbg-primary-\d+[^"'`]*["'`]/g)]
    .map((match) => match[0])
    .filter((classes) => /(^|[\s"'`:])text-white\b/.test(classes));
}

describe('the label on a primary fill', () => {
  it('finds a planted literal white label, so the scan can go red', () => {
    expect(literalWhiteOnPrimary(`className="bg-primary-600 text-white"`)).toHaveLength(1);
    expect(literalWhiteOnPrimary(`className="focus:bg-primary-600 focus:text-white"`)).toHaveLength(1);
    expect(literalWhiteOnPrimary(`className="bg-primary-600 text-onPrimary"`)).toHaveLength(0);
  });

  it('is text-onPrimary everywhere in the app and the kit, never a literal white', () => {
    const offenders = ROOTS.flatMap(sources).flatMap((file) =>
      literalWhiteOnPrimary(readFileSync(file, 'utf8')).map((classes) => `${file}: ${classes}`),
    );
    expect(offenders).toEqual([]);
  });
});
