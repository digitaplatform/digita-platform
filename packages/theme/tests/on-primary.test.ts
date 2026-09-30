import { describe, it, expect } from 'vitest';
import { DESIGNS, TINT_PALETTES, brandingStyle, synthesizeRamp, tintRamp, varsForTint, type TintKey } from '../src/index.js';

const AA = 4.5;

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

// The digita and simetrix signatures deliver #00b2f6 as their primary colour; the rest are planted
// fills across the range: a light cyan, the app's default blue, a dark indigo, a light amber, a near
// white and a near black.
const BRAND_COLOURS = ['#00b2f6', '#007AFF', '#312e81', '#f59e0b', '#e0f2fe', '#0b0b0b'];

describe('the label on a primary fill', () => {
  it('a fixed white label fails on the digita cyan, so the check below can go red', () => {
    expect(contrast('#FFFFFF', '#00b2f6')).toBeLessThan(AA);
  });

  it('reaches AA on step 600 of every tint preset, in both modes', () => {
    for (const key of Object.keys(TINT_PALETTES) as TintKey[]) {
      const ramp = tintRamp(key);
      for (const mode of ['light', 'dark'] as const) {
        const label = varsForTint(ramp, mode)['--color-on-primary'];
        expect(label, `${key} ${mode}`).toMatch(/^#[0-9a-f]{6}$/i);
        expect(contrast(label!, ramp['600']), `${key} ${mode} ${label} on ${ramp['600']}`).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it('reaches AA on step 600 of a branding ramp, the path a signature takes', () => {
    for (const colour of BRAND_COLOURS) {
      const ramp = synthesizeRamp(colour)!;
      const label = brandingStyle({ primary_color: colour }).properties['--color-on-primary'];
      expect(label, colour).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrast(label!, ramp['600']), `${label} on ${ramp['600']}`).toBeGreaterThanOrEqual(AA);
    }
  });

  it('keeps AA on the hover fill, which moves away from the label, for every tint and branding', () => {
    // The kit's old hover darkened to step 700: a dark label sinks to about 2:1 there.
    const blue = tintRamp('blue');
    expect(contrast(varsForTint(blue, 'light')['--color-on-primary']!, blue['700'])).toBeLessThan(AA);
    for (const key of Object.keys(TINT_PALETTES) as TintKey[]) {
      const vars = varsForTint(tintRamp(key), 'light');
      const hover = vars['--color-primary-hover'];
      expect(hover, key).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrast(vars['--color-on-primary']!, hover!), `${key} hover ${hover}`).toBeGreaterThanOrEqual(AA);
      expect(hover!.toLowerCase(), key).not.toBe(tintRamp(key)['600'].toLowerCase());
    }
    for (const colour of BRAND_COLOURS) {
      const props = brandingStyle({ primary_color: colour }).properties;
      expect(contrast(props['--color-on-primary']!, props['--color-primary-hover']!), colour).toBeGreaterThanOrEqual(AA);
    }
  });

  it('stays white where white reaches AA, so a dark fill keeps its white label', () => {
    expect(brandingStyle({ primary_color: '#312e81' }).properties['--color-on-primary']?.toUpperCase()).toBe('#FFFFFF');
  });

  it('belongs to the tint layer: no bundled design defines it', () => {
    for (const design of Object.values(DESIGNS)) {
      for (const mode of ['light', 'dark'] as const) {
        expect(design.semantic[mode].onPrimary, `${design.meta.id} ${mode}`).toBeUndefined();
      }
    }
  });
});

// A soft primary badge sits on the tonal primary container. Its label must reach AA on it in
// both modes, for every tint and every branding colour; step 700 on the dark card did not.
describe('the tonal primary container', () => {
  const pair = (value: string, mode: 'light' | 'dark') => {
    const m = /^light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)$/i.exec(value);
    return m ? (mode === 'light' ? m[1]! : m[2]!) : value;
  };

  it('the old label, step 700 of the digita cyan, fails on the dark card, so the check below can go red', () => {
    expect(contrast(synthesizeRamp('#00b2f6')!['700'], '#070e19')).toBeLessThan(AA);
  });

  it('reaches AA for its label in both modes, for every tint preset', () => {
    for (const key of Object.keys(TINT_PALETTES) as TintKey[]) {
      for (const mode of ['light', 'dark'] as const) {
        const vars = varsForTint(tintRamp(key), mode);
        const fill = vars['--color-primary-container']!;
        const label = vars['--color-on-primary-container']!;
        expect(contrast(label, fill), `${key} ${mode} ${label} on ${fill}`).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it('reaches AA for its label in both modes, for every branding colour', () => {
    for (const colour of BRAND_COLOURS) {
      const properties = brandingStyle({ primary_color: colour }).properties;
      for (const mode of ['light', 'dark'] as const) {
        const fill = pair(properties['--color-primary-container']!, mode);
        const label = pair(properties['--color-on-primary-container']!, mode);
        expect(contrast(label, fill), `${colour} ${mode} ${label} on ${fill}`).toBeGreaterThanOrEqual(AA);
      }
    }
  });
});
