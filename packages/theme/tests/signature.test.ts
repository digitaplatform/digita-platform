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

  it('applySignature applies a THIN delivered signature: primary ramp + font vars, no colour-world stamp', () => {
    const root = document.documentElement;
    registerSignature({
      id: 'thin1',
      name: 'Thin',
      accent: '#0E6FB8',
      fonts: { display: 'DisplayFont', sans: 'SansFont', mono: 'MonoFont' },
    });
    applySignature('thin1');
    // The accent hex is synthesized into an EXACT ramp (OKLCH, brand at 600).
    expect(root.style.getPropertyValue('--color-primary-600')).toBe(synthesizeRamp('#0E6FB8')!['600']);
    expect(root.style.getPropertyValue('--font-display')).toBe('DisplayFont');
    expect(root.style.getPropertyValue('--font-sans')).toBe('SansFont');
    expect(root.style.getPropertyValue('--font-mono')).toBe('MonoFont');
    // Thin: no colour world → no data-signature stamp.
    expect(root.getAttribute('data-signature')).toBe(null);
  });

  it('resolveInitialSignature() returns the default (digita, delivered) and honours a stored id as-is', () => {
    expect(DEFAULT_SIGNATURE_ID).toBe('digita');
    expect(resolveInitialSignature()).toBe('digita');
    // A stored id is honoured verbatim — it may be a DELIVERED signature not yet
    // registered at boot; getSignature resolves it (or the NONE floor) safely.
    localStorage.setItem('digita-ui:signature', 'anything');
    expect(resolveInitialSignature()).toBe('anything');
  });

  it('applySignature applies a FULL delivered signature: stamp + colour world + graphics', () => {
    const root = document.documentElement;
    registerSignature({
      id: 'full1',
      name: 'Full',
      accent: '#2077C8',
      fonts: { display: 'DisplayFont' },
      colors: {
        bg: { light: '#F5F8FB', dark: '#050B14' },
        textMain: { light: '#0D1B2A', dark: '#EAF1F8' },
      },
      graphics: {
        grid: { light: 'linear-gradient(a)', dark: 'linear-gradient(b)' },
        glow: { light: 'radial-gradient(c)', dark: 'radial-gradient(d)' },
      },
    });
    applySignature('full1');
    expect(root.getAttribute('data-signature')).toBe('full1');
    expect(root.style.getPropertyValue('--color-primary-600')).toBe(synthesizeRamp('#2077C8')!['600']);
    expect(root.style.getPropertyValue('--color-bg')).toBe('light-dark(#F5F8FB, #050B14)');
    expect(root.style.getPropertyValue('--color-text-main')).toBe('light-dark(#0D1B2A, #EAF1F8)');
    expect(root.style.getPropertyValue('--sig-grid-d')).toContain('linear-gradient');
    expect(root.style.getPropertyValue('--sig-glow-l')).toContain('radial-gradient');
    expect(root.style.getPropertyValue('--font-display')).toBe('DisplayFont');
  });

  it('switching FULL -> THIN tears down the colour world, keeps the thin accent', () => {
    const root = document.documentElement;
    registerSignature({
      id: 'full2',
      name: 'Full',
      accent: '#2077C8',
      colors: { bg: { light: '#FFFFFF', dark: '#000000' } },
      graphics: { grid: { light: 'linear-gradient(a)', dark: 'linear-gradient(b)' } },
    });
    registerSignature({ id: 'thin2', name: 'Thin', accent: '#0E6FB8' });
    applySignature('full2');
    applySignature('thin2');
    expect(root.getAttribute('data-signature')).toBe(null);
    expect(root.style.getPropertyValue('--color-bg')).toBe('');
    expect(root.style.getPropertyValue('--sig-grid-d')).toBe('');
    expect(root.style.getPropertyValue('--color-primary-600')).toBe(synthesizeRamp('#0E6FB8')!['600']);
  });

  it('resetSignature() removes the stamp and every signature-owned var', () => {
    const root = document.documentElement;
    registerSignature({
      id: 'full3',
      name: 'Full',
      accent: '#2077C8',
      colors: { bg: { light: '#FFFFFF', dark: '#000000' } },
      graphics: { glow: { light: 'radial-gradient(c)', dark: 'radial-gradient(d)' } },
    });
    applySignature('full3');
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
