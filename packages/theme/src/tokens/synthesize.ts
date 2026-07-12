import { PRIMARY } from './colors.js';

/**
 * Brand ramp synthesis — turn ONE brand hex into a full 50…950 ramp with the
 * same lightness dramaturgy as the built-in primary ramp.
 *
 * Method: convert to OKLCH (perceptual — equal ΔL reads as equal lightness
 * change), then walk the REFERENCE ramp and take over its lightness curve,
 * its per-step HUE DRIFT relative to step 600 (well-designed ramps run
 * slightly cooler in the light steps — a constant hue looks cheap there),
 * and scale each step's chroma by how chromatic the brand is relative to
 * the reference at 600. White-label tenants get consistent hovers, focus
 * rings and dark-mode contrast in every step, not just a recolored 600.
 *
 * Self-contained sRGB↔OKLCH (Björn Ottosson's OKLab) — no dependency.
 */

type Rgb = { r: number; g: number; b: number };
type Oklch = { L: number; C: number; H: number };

function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const toLinear = (c: number) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
};
const fromLinear = (x: number) => {
  const v = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
};

function rgbToOklch({ r, g, b }: Rgb): Oklch {
  const lr = toLinear(r),
    lg = toLinear(g),
    lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.sqrt(a * a + bb * bb);
  const H = (Math.atan2(bb, a) * 180) / Math.PI;
  return { L, C, H: H < 0 ? H + 360 : H };
}

function oklchToRgb({ L, C, H }: Oklch): Rgb {
  const rad = (H * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const bb = C * Math.sin(rad);
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * bb, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * bb, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * bb, 3);
  return {
    r: fromLinear(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

const toHex = ({ r, g, b }: Rgb) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** In-gamut check BEFORE clamping (a clamped channel means the color was outside). */
function inGamut({ L, C, H }: Oklch): boolean {
  const rad = (H * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const bb = C * Math.sin(rad);
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * bb, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * bb, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * bb, 3);
  const chans = [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return chans.every((c) => {
    const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055;
    return v >= -0.0005 && v <= 1.0005;
  });
}

/** Largest chroma at (L,H) that stays in sRGB — binary search, 12 iterations. */
function clampChroma(L: number, C: number, H: number): number {
  if (inGamut({ L, C, H })) return C;
  let lo = 0,
    hi = C;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut({ L, C: mid, H })) lo = mid;
    else hi = mid;
  }
  return lo;
}

export const RAMP_STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const;
export type RampStep = (typeof RAMP_STEPS)[number];

/**
 * Synthesize a full ramp from one brand hex. Returns null for unparsable
 * input (callers keep the default ramp). The brand color itself lands at
 * step 600 (the kit's "action" step).
 */
export function synthesizeRamp(brandHex: string): Record<RampStep, string> | null {
  const rgb = hexToRgb(brandHex);
  if (!rgb) return null;
  const brand = rgbToOklch(rgb);
  const ref600 = rgbToOklch(hexToRgb(PRIMARY['600']!)!);
  const chromaScale = ref600.C > 1e-6 ? brand.C / ref600.C : 0;

  const out = {} as Record<RampStep, string>;
  for (const step of RAMP_STEPS) {
    if (step === '600') {
      out[step] = toHex(oklchToRgb(brand));
      continue;
    }
    const ref = rgbToOklch(hexToRgb(PRIMARY[step]!)!);
    // Hue drift of the reference at this step, re-anchored on the brand hue.
    let hueDelta = ref.H - ref600.H;
    if (hueDelta > 180) hueDelta -= 360;
    if (hueDelta < -180) hueDelta += 360;
    const H = (brand.H + hueDelta + 360) % 360;
    const C = clampChroma(ref.L, ref.C * chromaScale, H);
    out[step] = toHex(oklchToRgb({ L: ref.L, C, H }));
  }
  return out;
}
