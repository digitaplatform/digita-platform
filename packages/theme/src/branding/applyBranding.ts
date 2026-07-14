import { COLOR_PALETTES, type PaletteName } from '../tokens/palettes.js';
import { cssVarName } from '../tokens/index.js';
import { synthesizeRamp } from '../tokens/synthesize.js';
import { TINT_PALETTES, type TintKey } from '../tokens/tints.js';
import { DEFAULT_DESIGN_ID, DESIGNS, getDesign } from '../designs/index.js';
import { getRuntimeDesign } from '../designs/runtime-registry.js';

/**
 * Framework-agnostic branding + theming runtime (pure DOM — no React/zustand) so
 * every surface (React frontends, digita-post's Express SPA, a future admin)
 * calls it identically. Branding only overrides the BRANDABLE ramps (primary +
 * secondary/accent) + mode + density; status/neutral/radii/shadows are fixed
 * product identity and are never touched here.
 *
 * The input matches the engine's BootBranding fields 1:1, so callers can do
 * `applyBranding(boot.branding)` with no mapping layer.
 */
export interface BrandingInput {
  /** Single hex for the PRIMARY ramp; a full 11-step ramp is SYNTHESIZED from it
   *  (OKLCH, the brand hex lands exactly at step 600) — never snapped to a preset. */
  primary_color?: string | null;
  /** Named palette for the SECONDARY/accent ramp (one of COLOR_PALETTES). */
  accent_palette?: string | null;
  density?: 'comfortable' | 'compact' | null;
  /** Brand font stacks — set inline as --font-display/--font-sans/--font-mono,
   *  which the Tailwind preset already reads (var(--font-*)). */
  fonts?: { display?: string | null; sans?: string | null; mono?: string | null };
}

export type ThemeMode = 'light' | 'dark' | 'system';
export type Density = 'comfortable' | 'compact' | 'spacious';

const STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
const DEFAULT_MODE_KEY = 'digita-ui:theme-mode';
const DEFAULT_DENSITY_KEY = 'digita-ui:density';
const DEFAULT_DESIGN_KEY = 'digita-ui:design';
const DEFAULT_TINT_KEY_PREFIX = 'digita-ui:tint';

function setRamp(target: HTMLElement, name: 'primary' | 'accent', palette: Record<string, string>): void {
  for (const step of STEPS) {
    const value = palette[step];
    if (value) target.style.setProperty(cssVarName(`${name}-${step}`), value);
  }
}

function clearRamp(target: HTMLElement, name: 'primary' | 'accent'): void {
  for (const step of STEPS) target.style.removeProperty(cssVarName(`${name}-${step}`));
}

/**
 * M3 tonal color roles derived from the APPLIED primary ramp (P3): a tenant
 * brand gets correct tonal containers, not the platform default's. Ramp steps
 * are mode-static, but the container roles flip with the mode (pale tint in
 * light, deep primary in dark) — and an inline style cannot vary by mode — so
 * both roles are written as `light-dark()` pairs. theme.css already sets
 * `color-scheme: light` on :root and `dark` on .dark, which is exactly the
 * signal light-dark() resolves against, so the roles track the live mode
 * toggle with zero JS. Steps mirror the semantic defaults: container =
 * ramp 100 (light) / 800 (dark), on-container = ramp 900 (light) / 100 (dark).
 */
function setContainerRoles(target: HTMLElement, ramp: Record<string, string>): void {
  const { 100: c100, 800: c800, 900: c900 } = ramp;
  if (!c100 || !c800 || !c900) return;
  target.style.setProperty(cssVarName('primaryContainer'), `light-dark(${c100}, ${c800})`);
  target.style.setProperty(cssVarName('onPrimaryContainer'), `light-dark(${c900}, ${c100})`);
}

function clearContainerRoles(target: HTMLElement): void {
  target.style.removeProperty(cssVarName('primaryContainer'));
  target.style.removeProperty(cssVarName('onPrimaryContainer'));
}

/** Apply branding overrides (idempotent; writes only brandable vars).
 *  Precedence note (ADR-V2): the primary vars written here are INLINE styles,
 *  so a tenant brand beats the user's `data-tint` pick, which beats the bare
 *  default — tenant brand > user tint > default blue. */
export function applyBranding(
  branding: BrandingInput | null | undefined,
  target: HTMLElement = document.documentElement,
): void {
  if (!branding) return;
  if (branding.accent_palette && branding.accent_palette in COLOR_PALETTES) {
    setRamp(target, 'accent', COLOR_PALETTES[branding.accent_palette as PaletteName]);
  }
  if (branding.primary_color) {
    // The primary ramp is SYNTHESIZED exactly from the brand hex (OKLCH, brand
    // at step 600) — no longer snapped to the nearest preset palette.
    const ramp = synthesizeRamp(branding.primary_color);
    if (ramp) {
      setRamp(target, 'primary', ramp);
      // P3: tonal container roles follow the applied primary ramp.
      setContainerRoles(target, ramp);
    }
  }
  if (branding.density) target.setAttribute('data-density', branding.density);
  if (branding.fonts) {
    for (const key of ['display', 'sans', 'mono'] as const) {
      const v = branding.fonts[key];
      // NOT cssVarName() — font vars are --font-*, exactly what the preset reads.
      if (typeof v === 'string' && v) target.style.setProperty(`--font-${key}`, v);
    }
  }
}

/** Clear all runtime branding overrides (back to the default token values). */
export function resetBranding(target: HTMLElement = document.documentElement): void {
  clearRamp(target, 'primary');
  clearRamp(target, 'accent');
  clearContainerRoles(target);
  target.removeAttribute('data-density');
  for (const key of ['display', 'sans', 'mono'] as const) target.style.removeProperty(`--font-${key}`);
}

// Single live listener so `system` mode follows the OS in real time; torn down
// the moment the user pins an explicit light/dark choice.
let systemMql: MediaQueryList | null = null;
let systemHandler: (() => void) | null = null;

function prefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

/** Apply the theme mode via the `.dark` class (class-based dark mode, unchanged
 *  across all apps). `system` resolves from the OS preference and keeps following
 *  it live; `light`/`dark` pin the choice and detach the OS listener. */
export function applyMode(mode: ThemeMode, target: HTMLElement = document.documentElement): void {
  if (systemMql && systemHandler) {
    systemMql.removeEventListener?.('change', systemHandler);
    systemMql = null;
    systemHandler = null;
  }
  const dark = mode === 'dark' || (mode === 'system' && prefersDark());
  target.classList.toggle('dark', dark);
  if (mode === 'system' && typeof window !== 'undefined' && window.matchMedia) {
    systemMql = window.matchMedia('(prefers-color-scheme: dark)');
    systemHandler = () => target.classList.toggle('dark', systemMql!.matches);
    systemMql.addEventListener?.('change', systemHandler);
  }
}

/** Set the per-user density (drives --density-pad/--density-gap via [data-density]). */
export function applyDensity(density: Density, target: HTMLElement = document.documentElement): void {
  target.setAttribute('data-density', density);
}

/** Select the active DESIGN by flipping `data-design` on <html>. The default
 *  design removes the attribute (falls through to the bare :root blocks = no
 *  flash). An unknown id is still written verbatim — a missing CSS block then
 *  surfaces VISIBLY as a fall-through to the default, never a silent guess. This
 *  is the outermost theming layer: mode (.dark) + tenant branding + density all
 *  compose within the chosen design. */
export function applyDesign(id: string, target: HTMLElement = document.documentElement): void {
  if (!id || id === DEFAULT_DESIGN_ID) target.removeAttribute('data-design');
  else target.setAttribute('data-design', id);
  // Stamp the component-variant family (material / ios) so the primitives pick up
  // the variant layer PURELY via CSS ([data-design-variant] selectors) — no JS
  // branching in components. 'default' (or none) removes the attribute.
  // Resolution order: a BAKED design's meta wins; else a RUNTIME-loaded design
  // plugin (registered via registerDesign, its injected CSS ships the variant
  // layer); else getDesign's visible fall-through to the default design.
  const variant =
    DESIGNS[id]?.meta.variant ?? getRuntimeDesign(id)?.variant ?? getDesign(id).meta.variant;
  if (!variant || variant === 'default') target.removeAttribute('data-design-variant');
  else target.setAttribute('data-design-variant', variant);
  // ADR-V2: restore the DESIGN'S stored tint pick (one localStorage key per
  // design) in the same synchronous task as the design stamp — no flash. No
  // stored pick → attribute removed → the default blue at the bare :root.
  applyTint(resolveInitialTint(id || DEFAULT_DESIGN_ID), target);
}

/** Select the active TINT (the user-picked primary color, ADR-V2) by flipping
 *  `data-tint` on <html>. The 9 valid keys live in TINT_PALETTES; `null`
 *  removes the attribute → the default blue painted at the bare :root.
 *  Composes below tenant branding (inline --color-primary-* wins) and above
 *  the design (design blocks are primary-less). Persisting the pick is the
 *  caller's job: write `${prefix}:${designId}` (see resolveInitialTint) so the
 *  choice is restored per design on the next applyDesign. */
export function applyTint(tint: TintKey | null, target: HTMLElement = document.documentElement): void {
  if (tint == null) target.removeAttribute('data-tint');
  else target.setAttribute('data-tint', tint);
}

/** The stored tint for ONE design (key `${keyPrefix}:${designId}`), validated
 *  against TINT_PALETTES; anything unknown/missing → null (= default blue). */
export function resolveInitialTint(
  designId: string,
  keyPrefix: string = DEFAULT_TINT_KEY_PREFIX,
): TintKey | null {
  try {
    const stored = localStorage.getItem(`${keyPrefix}:${designId}`);
    if (stored && stored in TINT_PALETTES) return stored as TintKey;
  } catch {
    /* private mode — fall through to the default */
  }
  return null;
}

/** Initial design from localStorage, else the default. */
export function resolveInitialDesign(storageKey: string = DEFAULT_DESIGN_KEY): string {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) return stored;
  } catch {
    /* private mode — fall through to the default */
  }
  return DEFAULT_DESIGN_ID;
}

/**
 * Pointer-derived density default — the "touch gets touch targets" idiom.
 *
 * When the user has NOT chosen a density, the initial one follows the pointer:
 *   - `(pointer: coarse)` (touch)          → 'spacious'    (44px rows — comfortable touch targets)
 *   - `(pointer: fine)`   (mouse/trackpad) → 'compact'     (32px rows — desktop data density)
 *   - no pointer / unknown (SSR, tests)    → 'comfortable' (the airy middle default)
 *
 * Component authors: the same signal exists in pure CSS —
 * `@media (pointer: coarse) { ... }` — prefer that for per-component idiom
 * tweaks (bigger hit areas, no hover-only affordances) instead of branching on
 * density in JS. This helper only decides the app-wide STARTING density; a
 * stored user preference always wins (see resolveInitialDensity).
 */
export function pointerDefaultDensity(): Density {
  if (typeof window !== 'undefined' && window.matchMedia) {
    if (window.matchMedia('(pointer: coarse)').matches) return 'spacious';
    if (window.matchMedia('(pointer: fine)').matches) return 'compact';
  }
  return 'comfortable';
}

/** Initial density: the stored user choice ALWAYS wins; otherwise default by
 *  pointer type (see pointerDefaultDensity). Resolution is synchronous — call
 *  `applyDensity(resolveInitialDensity())` once in the boot script before
 *  first paint, so the value is applied exactly once (no double-apply flash). */
export function resolveInitialDensity(storageKey: string = DEFAULT_DENSITY_KEY): Density {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === 'comfortable' || stored === 'compact' || stored === 'spacious') return stored;
  } catch {
    /* private mode — fall through to the pointer default */
  }
  return pointerDefaultDensity();
}

/** Initial mode from localStorage, else `system` (follow the OS preference live). */
export function resolveInitialMode(storageKey: string = DEFAULT_MODE_KEY): ThemeMode {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    /* private mode — fall through to the system default */
  }
  return 'system';
}
