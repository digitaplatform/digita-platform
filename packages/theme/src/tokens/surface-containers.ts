import { hexToRgb, toHex, type Rgb } from './synthesize.js';

/** The five Material 3 surface-container roles, from the page-level fill to the
 *  most raised container; the design's semantic defaults name them the same way. */
export const SURFACE_CONTAINER_ROLES = [
  'surfaceContainerLowest',
  'surfaceContainerLow',
  'surfaceContainer',
  'surfaceContainerHigh',
  'surfaceContainerHighest',
] as const;
export type SurfaceContainerRole = (typeof SURFACE_CONTAINER_ROLES)[number];

/**
 * Compose the surface-container ramp of one mode from a signature's `surface`
 * and `subtle` hex values: lowest is `surface`, container is `subtle`, and the
 * ramp continues past `subtle` by the same distance for highest, so the five
 * steps stay monotone and in the signature's own hue instead of the design's
 * grey. Linear in sRGB, like the values a signature writes; a signature that
 * wants another curve names the roles in its colours. Throws when either value
 * is not a six-digit hex, naming the signature, the token and the value: a
 * `#FFF` or rgba() surface would otherwise compose nothing and leave the
 * design's grey in place in silence.
 */
export function composeSurfaceContainerRamp(
  signatureId: string,
  surface: string,
  subtle: string,
): Record<SurfaceContainerRole, string> {
  const from = sixDigitHexToRgb(signatureId, 'surface', surface);
  const to = sixDigitHexToRgb(signatureId, 'subtle', subtle);
  const at = (t: number): string => {
    const channel = (a: number, b: number) => Math.round(Math.min(255, Math.max(0, a + (b - a) * t)));
    const rgb: Rgb = { r: channel(from.r, to.r), g: channel(from.g, to.g), b: channel(from.b, to.b) };
    return toHex(rgb);
  };
  return {
    surfaceContainerLowest: at(0),
    surfaceContainerLow: at(0.5),
    surfaceContainer: at(1),
    surfaceContainerHigh: at(1.5),
    surfaceContainerHighest: at(2),
  };
}

function sixDigitHexToRgb(signatureId: string, token: string, value: string): Rgb {
  const rgb = hexToRgb(value);
  if (!rgb) {
    throw new Error(
      `Signature "${signatureId}": colors.${token} "${value}" is not a six-digit hex; ` +
        'the surface-container ramp composes from six-digit hex surface and subtle per mode.',
    );
  }
  return rgb;
}
