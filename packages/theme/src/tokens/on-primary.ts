/** The contrast a label needs on a primary fill: WCAG AA for normal text. */
const AA_TEXT = 4.5;
const WHITE = '#FFFFFF';

function channels(hex: string): [number, number, number] {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`primary ramp colour is not a six-digit hex: ${hex}`);
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** The WCAG 2 contrast ratio between two six-digit hex colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

function scaled(hex: string, factor: number): string {
  return `#${channels(hex)
    .map((v) => Math.round(v * factor).toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * The label colour on a primary fill, which the kit draws in step 600 of the ramp in both modes:
 * white where white reaches AA, otherwise step 950 of the same ramp, darkened toward black until
 * it does. Every colour reaches AA against white or against black, so the darkening ends.
 */
export function onPrimaryFor(ramp: Record<string, string>): string {
  const fill = ramp['600'];
  if (!fill) throw new Error('primary ramp has no step 600');
  if (contrastRatio(WHITE, fill) >= AA_TEXT) return WHITE;
  const ink = ramp['950'] ?? '#000000';
  for (let factor = 1; factor > 0; factor -= 0.05) {
    const label = scaled(ink, factor);
    if (contrastRatio(label, fill) >= AA_TEXT) return label;
  }
  return '#000000';
}
