// minimal is the baked default: theme.css paints its tokens at :root. Its token values live in
// the @digitaplatform/minimal package only, so a copy here could only drift unseen.
import { describe, expect, it } from 'vitest';
import minimalPackage from '@digitaplatform/minimal/dist/index.js';
import { DESIGNS } from '../src/index.js';

/** The paths at which two designs carry different values, so a failure names each token. */
function tokenDisagreements(a: unknown, b: unknown, path = ''): string[] {
  if (Object.is(a, b)) return [];
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return [path || '(root)'];
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])].sort();
  return keys.flatMap((k) => tokenDisagreements(x[k], y[k], path ? `${path}.${k}` : k));
}

describe("minimal's tokens have one source", () => {
  it('the check names a token that two copies disagree on', () => {
    const copy = structuredClone(minimalPackage);
    copy.semantic.light.textMuted = '#71717A';
    expect(tokenDisagreements(copy, minimalPackage)).toEqual(['semantic.light.textMuted']);
  });

  it('the check passes a copy that agrees on every token', () => {
    expect(tokenDisagreements(structuredClone(minimalPackage), minimalPackage)).toEqual([]);
  });

  it("the theme's minimal agrees with the package's on every token", () => {
    expect(tokenDisagreements(DESIGNS.minimal, minimalPackage)).toEqual([]);
  });

  it("the theme declares no minimal token values of its own", () => {
    expect(DESIGNS.minimal).toBe(minimalPackage);
  });
});
