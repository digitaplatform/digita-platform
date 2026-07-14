// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyBranding,
  resetBranding,
  applySignature,
  resolveInitialSignature,
  SIGNATURES,
  DEFAULT_SIGNATURE_ID,
} from '../src/index.js';

describe('branding fonts + signature runtime', () => {
  beforeEach(() => {
    resetBranding();
    localStorage.clear();
  });

  it('applyBranding({fonts}) sets the inline --font-* vars the preset reads; resetBranding clears them', () => {
    const root = document.documentElement;
    applyBranding({ fonts: { display: 'X', sans: 'Y', mono: 'Z' } });
    expect(root.style.getPropertyValue('--font-display')).toBe('X');
    expect(root.style.getPropertyValue('--font-sans')).toBe('Y');
    expect(root.style.getPropertyValue('--font-mono')).toBe('Z');
    resetBranding();
    expect(root.style.getPropertyValue('--font-display')).toBe('');
    expect(root.style.getPropertyValue('--font-sans')).toBe('');
    expect(root.style.getPropertyValue('--font-mono')).toBe('');
  });

  it('applyBranding fonts are partial + null-safe (only the given stacks are written)', () => {
    const root = document.documentElement;
    applyBranding({ fonts: { display: 'OnlyDisplay', sans: null } });
    expect(root.style.getPropertyValue('--font-display')).toBe('OnlyDisplay');
    expect(root.style.getPropertyValue('--font-sans')).toBe('');
    expect(root.style.getPropertyValue('--font-mono')).toBe('');
  });

  it("applySignature('simetrix') writes a primary ramp AND the three --font-* vars via the branding layer", () => {
    const root = document.documentElement;
    applySignature('simetrix');
    // The accent hex snaps to the nearest accent palette → SOME --color-primary-* inline var.
    const primarySteps = Array.from(root.style).filter((p) => p.startsWith('--color-primary-'));
    expect(primarySteps.length).toBeGreaterThan(0);
    const fonts = SIGNATURES['simetrix']!.fonts!;
    expect(root.style.getPropertyValue('--font-display')).toBe(fonts.display);
    expect(root.style.getPropertyValue('--font-sans')).toBe(fonts.sans);
    expect(root.style.getPropertyValue('--font-mono')).toBe(fonts.mono);
  });

  it("resolveInitialSignature() returns 'simetrix' by default and validates stored ids", () => {
    expect(DEFAULT_SIGNATURE_ID).toBe('simetrix');
    expect(resolveInitialSignature()).toBe('simetrix');
    // Unknown stored id falls through to the default, never a silent guess.
    localStorage.setItem('digita-ui:signature', 'does-not-exist');
    expect(resolveInitialSignature()).toBe('simetrix');
  });
});
