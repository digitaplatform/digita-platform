import { describe, it, expect } from 'vitest';
import { TINT_PALETTES, brandingStyle, semantic, signatureStyle, synthesizeRamp, tintRamp, varsForTint, type TintKey } from '../src/index.js';

const TEXT = 4.5;
const GRAPHIC = 3;

/** WCAG 2 contrast ratio between two six-digit hex colours, written here so the test does not trust the code under test. */
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

function modes(value: string | undefined): { light: string; dark: string } {
  const pair = /^light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\)$/i.exec(value ?? '');
  expect(pair, `a light-dark() pair of hex colours, got ${value}`).not.toBeNull();
  return { light: pair![1]!, dark: pair![2]! };
}

const GROUNDS = {
  light: [semantic.light.bg, semantic.light.surface],
  dark: [semantic.dark.bg, semantic.dark.surface],
};

// A dark copper, a mid forest green and the light digita cyan: step 600 of each fails one mode as text.
const BRAND_COLOURS = ['#B8541E', '#1F7A5C', '#00B2F6'];

describe('the primary colour drawn on the page surface', () => {
  it('step 600 as text fails a mode for every brand colour, so the checks below can go red', () => {
    for (const colour of BRAND_COLOURS) {
      const step600 = synthesizeRamp(colour)!['600'];
      const passesBoth = (['light', 'dark'] as const).every((mode) => GROUNDS[mode].every((g) => contrast(step600, g) >= TEXT));
      expect(passesBoth, colour).toBe(false);
    }
  });

  it('reaches 4.5:1 as text and 3:1 as a graphic on both grounds of each mode, for a branding', () => {
    for (const colour of BRAND_COLOURS) {
      const properties = brandingStyle({ primary_color: colour }).properties;
      const text = modes(properties['--color-primary-text']);
      const graphic = modes(properties['--color-primary-graphic']);
      for (const mode of ['light', 'dark'] as const) {
        for (const ground of GROUNDS[mode]) {
          expect(contrast(text[mode], ground), `${colour} text ${mode} on ${ground}`).toBeGreaterThanOrEqual(TEXT);
          expect(contrast(graphic[mode], ground), `${colour} graphic ${mode} on ${ground}`).toBeGreaterThanOrEqual(GRAPHIC);
        }
      }
    }
  });

  it('keeps the brand colour itself where it already reaches the minimum', () => {
    // The digita cyan reaches 3:1 on the dark grounds, so in dark mode a graphic stays #00B2F6.
    const ramp = synthesizeRamp('#00B2F6')!;
    const graphic = modes(brandingStyle({ primary_color: '#00B2F6' }).properties['--color-primary-graphic']);
    expect(graphic.dark.toLowerCase()).toBe(ramp['600'].toLowerCase());
    expect(graphic.light.toLowerCase()).not.toBe(ramp['600'].toLowerCase());
  });

  it('measures a signature against its own grounds', () => {
    // A blue-black canvas darker than the default dark ground: the role must follow it.
    const colors = {
      bg: { light: '#FFFFFF', dark: '#05070D' },
      surface: { light: '#F4F6FA', dark: '#0B1220' },
    };
    const properties = signatureStyle({ id: 'planted', name: 'Planted', accent: '#1F7A5C', colors }).properties;
    const text = modes(properties['--color-primary-text']);
    for (const mode of ['light', 'dark'] as const) {
      for (const ground of [colors.bg[mode], colors.surface[mode]]) {
        expect(contrast(text[mode], ground), `text ${mode} on ${ground}`).toBeGreaterThanOrEqual(TEXT);
      }
    }
  });

  it('reaches 4.5:1 as text and 3:1 as a graphic for every tint preset, in both modes', () => {
    for (const key of Object.keys(TINT_PALETTES) as TintKey[]) {
      for (const mode of ['light', 'dark'] as const) {
        const vars = varsForTint(tintRamp(key), mode);
        for (const ground of GROUNDS[mode]) {
          expect(contrast(vars['--color-primary-text']!, ground), `${key} text ${mode}`).toBeGreaterThanOrEqual(TEXT);
          expect(contrast(vars['--color-primary-graphic']!, ground), `${key} graphic ${mode}`).toBeGreaterThanOrEqual(GRAPHIC);
        }
      }
    }
  });
});
