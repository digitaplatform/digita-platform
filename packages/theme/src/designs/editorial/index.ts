import type { Design } from '../types.js';
import { semantic } from '../../tokens/semantic.js';
import { NEUTRAL, ACCENT } from '../../tokens/colors.js';
import { borderRadius, shadowValues, motionValues } from '../../tokens/scales.js';

/**
 * The DEFAULT design — INK & LEDGER (ADR-V1): warm bone neutral, copper
 * accent, Fraunces serif display. Assembled BY REFERENCE from the token
 * source (semantic.ts / colors.ts / scales.ts) so the generated theme.css
 * stays identical to the guard baseline — the gen-css equality guard remains
 * the single source of truth for these values. ADR-V2: the primary ramp is
 * the TINT layer's (default iOS blue; the ledger-green survives as the
 * 'green' tint grid entry).
 */
const editorial: Design = {
  meta: {
    id: 'editorial',
    name: 'Editorial',
    description: 'Warm editorial — bone paper, ruled structure, Fraunces serif display.',
    variant: 'editorial',
  },
  semantic,
  // ADR-V2: no primary ramp — the tint layer owns it (default iOS blue).
  ramps: { neutral: NEUTRAL, accent: ACCENT },
  radius: { ...borderRadius },
  shadow: { light: shadowValues.light, dark: shadowValues.dark },
  // typography intentionally omitted → inherits the platform fontFamily scale
  // (Inter sans, Fraunces/Georgia serif display, mono) via gen-css typoFor.
  motion: { ...motionValues },
  // Warm editorial identity palette — teal, copper, indigo, plum, moss, ochre,
  // rose, slate (on the bone neutral). Belonging, not status.
  categorical: {
    light: ['#0F766E', '#B45309', '#4338CA', '#9333EA', '#4D7C0F', '#A16207', '#BE123C', '#57534E'],
    dark: ['#2DD4BF', '#FB923C', '#818CF8', '#C084FC', '#A3E635', '#FCD34D', '#FB7185', '#A8A29E'],
  },
};

export default editorial;
