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
