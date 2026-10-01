/** The contrast a label needs on a primary fill: WCAG AA for normal text. */
const AA_TEXT = 4.5;
/** The contrast a graphic needs on its ground: WCAG AA for non-text contrast. */
const AA_GRAPHIC = 3;
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

function mixed(hex: string, toward: string, weight: number): string {
  const [a, b] = [channels(hex), channels(toward)];
  return `#${a
    .map((v, i) => Math.round(v + (b[i]! - v) * weight).toString(16).padStart(2, '0'))
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
  for (let step = 0; step < 20; step += 1) {
    const label = mixed(ink, '#000000', step * 0.05);
    if (contrastRatio(label, fill) >= AA_TEXT) return label;
  }
  return '#000000';
}

/**
 * The fill of a primary action on hover: step 600 moved 12% away from its label, darker under a
 * white label and lighter under a dark one, so hovering never lowers the label's contrast below
 * the rest state's. A ramp step cannot serve: under a dark label step 700 falls to about 2:1.
 */
export function primaryHoverFor(ramp: Record<string, string>): string {
  const fill = ramp['600'];
  if (!fill) throw new Error('primary ramp has no step 600');
  return mixed(fill, onPrimaryFor(ramp) === WHITE ? '#000000' : WHITE, 0.12);
}

// Step 600 first, then outward one step at a time, so the brand colour itself wins wherever it passes.
const STEPS_FROM_BRAND = ['600', '700', '500', '800', '400', '900', '300', '950', '200', '100', '50'];

function primaryOnGrounds(ramp: Record<string, string>, grounds: string[], minimum: number): string {
  const weakest = (step: string) => Math.min(...grounds.map((ground) => contrastRatio(ramp[step]!, ground)));
  const steps = STEPS_FROM_BRAND.filter((step) => ramp[step]);
  // A ground no step can reach gets the strongest step, and the signature kit's check shows the miss.
  return ramp[steps.find((step) => weakest(step) >= minimum) ?? steps.reduce((a, b) => (weakest(a) >= weakest(b) ? a : b))]!;
}

/**
 * The primary colour drawn as text on the page in one mode: the ramp step closest to step 600 that
 * reaches AA on every ground of that mode. Step 600 alone serves one mode only, because no colour
 * reaches 4.5:1 on both a light and a dark canvas.
 */
export function primaryTextFor(ramp: Record<string, string>, grounds: string[]): string {
  return primaryOnGrounds(ramp, grounds, AA_TEXT);
}

/** The primary colour drawn as a graphic on the page in one mode (an icon, a focus ring, an active
 *  tab's rule): the ramp step closest to step 600 that reaches 3:1 on every ground of that mode. */
export function primaryGraphicFor(ramp: Record<string, string>, grounds: string[]): string {
  return primaryOnGrounds(ramp, grounds, AA_GRAPHIC);
}
