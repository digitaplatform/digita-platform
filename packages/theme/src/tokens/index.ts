import { semantic } from './semantic.js';
import { PRIMARY, NEUTRAL, ACCENT } from './colors.js';
import {
  fontFamily,
  boxShadow,
  spacing,
  borderRadius,
  letterSpacing,
  transitionDuration,
  transitionTimingFunction,
  shadowValues,
  motionValues,
} from './scales.js';
import type { Design } from '../designs/types.js';
import { getDesign, DEFAULT_DESIGN_ID } from '../designs/index.js';

export { semantic } from './semantic.js';
export type { SemanticTokens } from './semantic.js';
export { PRIMARY, NEUTRAL, ACCENT } from './colors.js';
export { COLOR_PALETTES } from './palettes.js';
export { synthesizeRamp, RAMP_STEPS } from './synthesize.js';
export type { RampStep } from './synthesize.js';
export { TINT_PALETTES, DEFAULT_TINT_KEY, tintRamp } from './tints.js';
export type { TintKey } from './tints.js';
export type { PaletteName, ColorRamp } from './palettes.js';
export {
  fontFamily,
  fontSize,
  boxShadow,
  spacing,
  borderRadius,
  letterSpacing,
  zIndex,
  transitionDuration,
  transitionTimingFunction,
  shadowValues,
  motionValues,
} from './scales.js';

/** camelCase / `name-step` → kebab (textMain → text-main, primary-500 → primary-500). */
export function kebab(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** The ONE token→CSS-variable transform, shared by gen-css.mjs AND preset.ts so a
 *  utility class and its CSS variable can never diverge. */
export function cssVarName(token: string): string {
  return `--color-${kebab(token)}`;
}

/** Fixed ramps keyed by name (each becomes --color-<name>-<step> + a Tailwind ramp). */
export const RAMPS: Record<string, Record<string, string>> = {
  primary: PRIMARY,
  neutral: NEUTRAL,
  accent: ACCENT,
};

/** Flat { cssVarName: value } for one DESIGN + mode = its semantic tokens + every
 *  ramp step (design ramp override, else the platform default). The generalization
 *  of varsForMode — drives the per-design scoped blocks in gen-css.mjs.
 *  ADR-V2: the PRIMARY ramp is deliberately EXCLUDED — design blocks are
 *  primary-less so the tint layer (bare :root blue default, later-source
 *  [data-tint] blocks, tenant branding inline styles) owns --color-primary-*. */
export function varsForDesign(design: Design, mode: 'light' | 'dark'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(design.semantic[mode])) {
    if (value != null) out[cssVarName(key)] = value;
  }
  const { primary: _primary, ...platformRamps } = RAMPS;
  const ramps: Record<string, Record<string, string> | undefined> = { ...platformRamps, ...(design.ramps ?? {}) };
  for (const [name, ramp] of Object.entries(ramps)) {
    if (!ramp) continue;
    for (const [step, value] of Object.entries(ramp)) out[cssVarName(`${name}-${step}`)] = value;
  }
  return out;
}

/** ADR-V2 tint layer: flat { cssVarName: value } for one TINT ramp + mode —
 *  the full --color-primary-50..950 ramp plus the mode-flipping tonal
 *  container roles (light: ramp 100/900, dark: ramp 800/100 — the same rule
 *  as runtime branding's setContainerRoles). Drives the bare-:root BLUE
 *  default and every :root[data-tint="…"] block in gen-css.mjs. */
export function varsForTint(ramp: Record<string, string>, mode: 'light' | 'dark'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [step, value] of Object.entries(ramp)) out[cssVarName(`primary-${step}`)] = value;
  out[cssVarName('primaryContainer')] = mode === 'light' ? ramp['100']! : ramp['800']!;
  out[cssVarName('onPrimaryContainer')] = mode === 'light' ? ramp['900']! : ramp['100']!;
  return out;
}

/** Flat { cssVarName: value } for one mode of the DEFAULT design = semantic tokens
 *  + every ramp step. Drives the bare :root / .dark blocks in gen-css.mjs. */
export function varsForMode(mode: 'light' | 'dark'): Record<string, string> {
  return varsForDesign(getDesign(DEFAULT_DESIGN_ID), mode);
}

/** Per-mode --shadow-* vars (gen-css merges these into each mode block). */
export function shadowVarsForMode(mode: 'light' | 'dark'): Record<string, string> {
  return { ...shadowValues[mode] };
}

/** Mode-agnostic motion vars (gen-css emits into :root). */
export function motionVars(): Record<string, string> {
  return { ...motionValues };
}

export const tokens = {
  semantic,
  ramps: RAMPS,
  fontFamily,
  boxShadow,
  spacing,
  borderRadius,
  letterSpacing,
  transitionDuration,
  transitionTimingFunction,
} as const;
