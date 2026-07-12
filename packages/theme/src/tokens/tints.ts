import { synthesizeRamp, type RampStep } from './synthesize.js';

/**
 * ADR-V2 — the TINT layer: the primary (action) color is decoupled from the
 * design. A design decides typography, radius, shadows, surfaces and variant
 * CSS; the primary ramp comes from ONE shared 3x3 tint grid that the user
 * picks from PER DESIGN (persisted in localStorage, see applyTint /
 * resolveInitialTint in branding/applyBranding.ts).
 *
 * Each entry is the step-600 SEED of an 11-step ramp — the full ramp is
 * synthesized at build time via synthesizeRamp(hex) (OKLCH, brand at 600),
 * so every tint gets the same lightness dramaturgy, hovers and dark-mode
 * contrast as the built-in ramps. gen-css emits a
 * `:root[data-tint="<key>"]` / `...].dark` pair per tint.
 *
 * The DEFAULT for ALL designs is iOS blue #007AFF (itself a grid entry) —
 * painted at the bare :root, no attribute needed, no first-paint flash.
 *
 * Precedence (weakest → strongest): default blue < data-tint (user pick)
 * < tenant branding (applyBranding inline --color-primary-*).
 */
export const TINT_PALETTES = {
  blue: { name: 'Blue', hex: '#007AFF' },
  indigo: { name: 'Indigo', hex: '#4F46E5' },
  violet: { name: 'Violet', hex: '#6750A4' },
  teal: { name: 'Teal', hex: '#0D9488' },
  green: { name: 'Green', hex: '#166E5A' },
  cyan: { name: 'Cyan', hex: '#0891B2' },
  crimson: { name: 'Crimson', hex: '#DC2626' },
  magenta: { name: 'Magenta', hex: '#DB2777' },
  amber: { name: 'Amber', hex: '#D97706' },
} as const;

export type TintKey = keyof typeof TINT_PALETTES;

/** The default tint painted at the bare :root — iOS blue, for every design. */
export const DEFAULT_TINT_KEY: TintKey = 'blue';

/** The full 11-step ramp of a tint (seed lands at step 600). The seeds above
 *  are known-valid hex, so synthesis can never reject them. */
export function tintRamp(key: TintKey): Record<RampStep, string> {
  const ramp = synthesizeRamp(TINT_PALETTES[key].hex);
  if (!ramp) throw new Error(`[theme] tint seed for "${key}" failed to synthesize`);
  return ramp;
}
