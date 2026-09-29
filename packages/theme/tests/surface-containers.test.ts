// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { applySignature, registerSignature, resetBranding, resetSignature } from '../src/index.js';
import { composeSurfaceContainerRamp, SURFACE_CONTAINER_ROLES } from '../src/tokens/surface-containers.js';

// The digita and simetrix signatures share these surface and subtle values
// (digita-plugins-free/digita/src/index.ts, digita-plugins-free/simetrix/src/index.ts).
const DIGITA = {
  surface: { light: '#FFFFFF', dark: '#070E19' },
  subtle: { light: '#F0F5FA', dark: '#0B1F33' },
  textMain: { light: '#13283C', dark: '#EAF1F8' },
};

/** WCAG 2 contrast ratio between two six-digit hex colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('surface-container ramp of a signature', () => {
  beforeEach(() => {
    resetSignature();
    resetBranding();
  });

  it('composeSurfaceContainerRamp walks surface → subtle → one step past subtle, monotone in sRGB', () => {
    expect(composeSurfaceContainerRamp('t', '#FFFFFF', '#F0F5FA')).toEqual({
      surfaceContainerLowest: '#ffffff',
      surfaceContainerLow: '#f8fafd',
      surfaceContainer: '#f0f5fa',
      surfaceContainerHigh: '#e9f0f8',
      surfaceContainerHighest: '#e1ebf5',
    });
    expect(composeSurfaceContainerRamp('t', '#070E19', '#0B1F33')).toEqual({
      surfaceContainerLowest: '#070e19',
      surfaceContainerLow: '#091726',
      surfaceContainer: '#0b1f33',
      surfaceContainerHigh: '#0d2840',
      surfaceContainerHighest: '#0f304d',
    });
    // A step past subtle never leaves the sRGB gamut.
    expect(composeSurfaceContainerRamp('t', '#000000', '#FF0000').surfaceContainerHighest).toBe('#ff0000');
    // An rgba() subtle cannot be composed and says so instead of keeping the design's ramp.
    expect(() => composeSurfaceContainerRamp('t', '#FFFFFF', 'rgba(255,255,255,.72)')).toThrow(
      'Signature "t": colors.subtle "rgba(255,255,255,.72)" is not a six-digit hex',
    );
  });

  it('the digita highest step stands apart from surface by at least 1.2:1 in light and dark', () => {
    const light = composeSurfaceContainerRamp('t', DIGITA.surface.light, DIGITA.subtle.light);
    const dark = composeSurfaceContainerRamp('t', DIGITA.surface.dark, DIGITA.subtle.dark);
    // Light: #FFFFFF against #e1ebf5 is 1.2067:1; dark: #070E19 against #0f304d is 1.4276:1.
    expect(contrast(DIGITA.surface.light, light.surfaceContainerHighest)).toBeCloseTo(1.2067, 3);
    expect(contrast(DIGITA.surface.dark, dark.surfaceContainerHighest)).toBeCloseTo(1.4276, 3);
    expect(contrast(DIGITA.surface.light, light.surfaceContainerHighest)).toBeGreaterThanOrEqual(1.2);
    expect(contrast(DIGITA.surface.dark, dark.surfaceContainerHighest)).toBeGreaterThanOrEqual(1.2);
  });

  it('the digita text on a field (highest) keeps WCAG AA body contrast, 4.5:1, in light and dark', () => {
    const light = composeSurfaceContainerRamp('t', DIGITA.surface.light, DIGITA.subtle.light);
    const dark = composeSurfaceContainerRamp('t', DIGITA.surface.dark, DIGITA.subtle.dark);
    // Light: #13283C on #e1ebf5 is 12.4625:1; dark: #EAF1F8 on #0f304d is 11.8923:1.
    expect(contrast(DIGITA.textMain.light, light.surfaceContainerHighest)).toBeCloseTo(12.4625, 3);
    expect(contrast(DIGITA.textMain.dark, dark.surfaceContainerHighest)).toBeCloseTo(11.8923, 3);
    expect(contrast(DIGITA.textMain.light, light.surfaceContainerHighest)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(DIGITA.textMain.dark, dark.surfaceContainerHighest)).toBeGreaterThanOrEqual(4.5);
  });

  it('applySignature writes the five composed roles as light-dark() for a signature without explicit roles', () => {
    const root = document.documentElement;
    registerSignature({ id: 'ramp1', name: 'Ramp', accent: '#0E6FB8', colors: DIGITA });
    applySignature('ramp1');
    expect(root.style.getPropertyValue('--color-surface-container-lowest')).toBe('light-dark(#ffffff, #070e19)');
    expect(root.style.getPropertyValue('--color-surface-container-low')).toBe('light-dark(#f8fafd, #091726)');
    expect(root.style.getPropertyValue('--color-surface-container')).toBe('light-dark(#f0f5fa, #0b1f33)');
    expect(root.style.getPropertyValue('--color-surface-container-high')).toBe('light-dark(#e9f0f8, #0d2840)');
    // The input frame under Material reads this role; it must not stay at the design's grey.
    expect(root.style.getPropertyValue('--color-surface-container-highest')).toBe('light-dark(#e1ebf5, #0f304d)');
  });

  it('a role the signature names explicitly wins over the composed value', () => {
    const root = document.documentElement;
    registerSignature({
      id: 'ramp2',
      name: 'Ramp',
      accent: '#0E6FB8',
      colors: { ...DIGITA, surfaceContainerHighest: { light: '#AAAAAA', dark: '#111111' } },
    });
    applySignature('ramp2');
    expect(root.style.getPropertyValue('--color-surface-container-highest')).toBe('light-dark(#AAAAAA, #111111)');
    expect(root.style.getPropertyValue('--color-surface-container-high')).toBe('light-dark(#e9f0f8, #0d2840)');
  });

  it('a surface that is not a six-digit hex refuses loudly instead of leaving the design grey in silence', () => {
    registerSignature({
      id: 'ramp5',
      name: 'Ramp',
      accent: '#0E6FB8',
      colors: { ...DIGITA, surface: { light: '#FFF', dark: '#070E19' } },
    });
    expect(() => applySignature('ramp5')).toThrow(
      'Signature "ramp5": colors.surface "#FFF" is not a six-digit hex',
    );
  });

  it('a signature without surface or subtle leaves the design ramp alone; the teardown clears every role', () => {
    const root = document.documentElement;
    registerSignature({ id: 'ramp3', name: 'Ramp', accent: '#0E6FB8', colors: { bg: { light: '#FFF', dark: '#000' } } });
    applySignature('ramp3');
    for (const role of SURFACE_CONTAINER_ROLES) {
      expect(root.style.getPropertyValue(`--color-${role.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`)).toBe('');
    }
    registerSignature({ id: 'ramp4', name: 'Ramp', accent: '#0E6FB8', colors: DIGITA });
    applySignature('ramp4');
    expect(root.style.getPropertyValue('--color-surface-container-highest')).not.toBe('');
    resetSignature();
    expect(root.style.getPropertyValue('--color-surface-container-highest')).toBe('');
    expect(root.style.getPropertyValue('--color-surface-container-lowest')).toBe('');
  });
});
