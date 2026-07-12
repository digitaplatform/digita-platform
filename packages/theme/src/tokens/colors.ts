import { type ColorRamp } from './palettes.js';

/**
 * Fixed color ramps (50..950), mode-independent. These become --color-<name>-<step>
 * CSS variables + the matching Tailwind utilities (primary-*, neutral-*, accent-*).
 *
 * - PRIMARY: ADR-V2 — no longer painted as the default --color-primary-* (the
 *   TINT layer owns that; default = iOS blue, see tints.ts). It stays UNCHANGED
 *   as the synthesis REFERENCE ramp (synthesizeRamp's lightness/hue-drift/
 *   chroma curve + the gen-css ramp self-test) and as the 'green' tint seed.
 * - NEUTRAL: a full neutral scale (Tailwind's neutral hues) — declared as tokens
 *   so apps use brandable `neutral-*` utilities instead of raw palette classes.
 * - ACCENT: the brandable SECONDARY color ramp (default indigo), swapped at
 *   runtime via the branding accent_palette.
 */
// INK & LEDGER identity (ADR-V1): PRIMARY = ledger-green (action, 600 = #166E5A;
// hand-tuned to a monotonic lightness curve so 700 is a visibly darker hover),
// NEUTRAL = a warm stone ramp (bone → warm charcoal) replacing the cool Tailwind
// neutral, ACCENT = copper. Runtime branding (applyBranding) can still snap
// primary/accent to a COLOR_PALETTES choice; these are the platform defaults.
export const PRIMARY: ColorRamp = {
  50: '#EEF5F1', 100: '#D6E8E0', 200: '#AFD3C5', 300: '#7FB8A4', 400: '#4E9A82',
  500: '#2A8168', 600: '#166E5A', 700: '#0F5A49', 800: '#114A3D', 900: '#123D33', 950: '#0A241E',
};

export const NEUTRAL: ColorRamp = {
  50: '#FAF9F5', 100: '#F2EFE8', 200: '#E8E4DA', 300: '#D9D4C7', 400: '#B8B1A2',
  500: '#938D80', 600: '#6F6A5F', 700: '#524E45', 800: '#35312A', 900: '#24211C', 950: '#171512',
};

export const ACCENT: ColorRamp = {
  50: '#FAF4F1', 100: '#F4E5E0', 200: '#ECD1CA', 300: '#E1B5AA', 400: '#CF917F',
  500: '#BC7153', 600: '#B5623A', 700: '#954617', 800: '#793A14', 900: '#63341A', 950: '#3D2212',
};
