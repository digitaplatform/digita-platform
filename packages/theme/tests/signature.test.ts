// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyBranding,
  resetBranding,
  applySignature,
  resetSignature,
  resolveInitialSignature,
  synthesizeRamp,
  SIGNATURES,
  DEFAULT_SIGNATURE_ID,
  registerSignature,
  getSignature,
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
    // The accent hex is synthesized into an EXACT ramp (OKLCH, brand at 600) —
    // simetrix's azure must paint verbatim, not snap to a preset palette.
    const primarySteps = Array.from(root.style).filter((p) => p.startsWith('--color-primary-'));
    expect(primarySteps.length).toBeGreaterThan(0);
    expect(root.style.getPropertyValue('--color-primary-600')).toBe(
      synthesizeRamp('#0E6FB8')!['600'],
    );
    const fonts = SIGNATURES['simetrix']!.fonts!;
    expect(root.style.getPropertyValue('--font-display')).toBe(fonts.display);
    expect(root.style.getPropertyValue('--font-sans')).toBe(fonts.sans);
    expect(root.style.getPropertyValue('--font-mono')).toBe(fonts.mono);
  });

  it("resolveInitialSignature() returns 'digita' by default and validates stored ids", () => {
    expect(DEFAULT_SIGNATURE_ID).toBe('digita');
    expect(resolveInitialSignature()).toBe('digita');
    // A valid stored id is honoured.
    localStorage.setItem('digita-ui:signature', 'simetrix');
    expect(resolveInitialSignature()).toBe('simetrix');
    // Unknown stored id falls through to the default, never a silent guess.
    localStorage.setItem('digita-ui:signature', 'does-not-exist');
    expect(resolveInitialSignature()).toBe('digita');
  });

  it("applySignature('digita') stamps data-signature and writes the brand colour world + graphics", () => {
    const root = document.documentElement;
    applySignature('digita');
    // The full signature stamps the CSS anchor the shell backdrop keys on.
    expect(root.getAttribute('data-signature')).toBe('digita');
    // Accent ramp anchors on the digita mid-blue, exact (not snapped).
    expect(root.style.getPropertyValue('--color-primary-600')).toBe(synthesizeRamp('#3896E6')!['600']);
    // Colour world: canvas is a per-mode light-dark() pair (navy in dark).
    expect(root.style.getPropertyValue('--color-bg')).toBe('light-dark(#F5F8FB, #050B14)');
    expect(root.style.getPropertyValue('--color-text-main')).toBe('light-dark(#0D1B2A, #EAF1F8)');
    // Graphics: the grid ships explicit light + dark values (url()/gradients can't light-dark()).
    expect(root.style.getPropertyValue('--sig-grid-d')).toContain('linear-gradient');
    expect(root.style.getPropertyValue('--sig-glow-l')).toContain('radial-gradient');
    // Fonts still flow through the branding layer.
    expect(root.style.getPropertyValue('--font-display')).toBe(SIGNATURES['digita']!.fonts!.display);
  });

  it('switching to a thin signature (simetrix) tears down the digita colour world', () => {
    const root = document.documentElement;
    applySignature('digita');
    applySignature('simetrix');
    // simetrix carries no colours/graphics → the stamp and every --sig/--color world var are gone.
    expect(root.getAttribute('data-signature')).toBe(null);
    expect(root.style.getPropertyValue('--color-bg')).toBe('');
    expect(root.style.getPropertyValue('--sig-grid-d')).toBe('');
    // …but simetrix's own accent ramp is applied.
    expect(root.style.getPropertyValue('--color-primary-600')).toBe(synthesizeRamp('#0E6FB8')!['600']);
  });

  it('resetSignature() removes the stamp and every signature-owned var', () => {
    const root = document.documentElement;
    applySignature('digita');
    resetSignature();
    expect(root.getAttribute('data-signature')).toBe(null);
    expect(root.style.getPropertyValue('--color-bg')).toBe('');
    expect(root.style.getPropertyValue('--sig-glow-d')).toBe('');
  });

  it('registerSignature: a runtime-DELIVERED signature is resolved by getSignature and applied in full', () => {
    const root = document.documentElement;
    // A delivered id unknown to the baked SIGNATURES record.
    expect('acme' in SIGNATURES).toBe(false);
    registerSignature({
      id: 'acme',
      name: 'Acme',
      accent: '#2077C8',
      fonts: { display: "'X', sans-serif" },
      monogram: '<svg viewBox="0 0 1 1"></svg>',
      colors: { bg: { light: '#FFFFFF', dark: '#000000' } },
      graphics: { glow: { light: 'radial-gradient(#fff)', dark: 'radial-gradient(#000)' } },
    });
    // getSignature resolves the delivered config (not the default fallback).
    expect(getSignature('acme').id).toBe('acme');
    expect(getSignature('acme').monogram).toContain('<svg');
    // applySignature writes the delivered brand world in full.
    applySignature('acme');
    expect(root.getAttribute('data-signature')).toBe('acme');
    expect(root.style.getPropertyValue('--color-bg')).toBe('light-dark(#FFFFFF, #000000)');
    expect(root.style.getPropertyValue('--sig-glow-l')).toBe('radial-gradient(#fff)');
    expect(root.style.getPropertyValue('--color-primary-600')).toBe(synthesizeRamp('#2077C8')!['600']);
  });
});
