import { brandingStyle, pageRoleProperties, resetBranding, writeIdentityStyle, type IdentityStyle } from '../runtime/runtime.js';
import { cssVarName } from '../tokens/index.js';
import { synthesizeRamp } from '../tokens/synthesize.js';
import { composeSurfaceContainerRamp, SURFACE_CONTAINER_ROLES } from '../tokens/surface-containers.js';
import { getRuntimeSignature } from './runtime-registry.js';

/**
 * SIGNATURES — built-in identity overlays. A signature is NOT a design: it is a
 * brand identity (accent + fonts + the full brand colour world + decorative
 * background graphics + logo/wordmark) that rides the BRANDING layer (inline
 * vars), so it COMPOSES on top of whatever design skin is active. Apply it
 * ALONGSIDE `data-design`, not instead of it — flipping the design keeps the
 * signature (a design owns CONTROL shapes; a signature owns the brand WORLD),
 * and vice versa.
 *
 * A thin signature (accent + fonts only, e.g. simetrix) writes just the primary
 * ramp + --font-* vars. A FULL signature (e.g. digita) additionally stamps
 * `data-signature=<id>` and writes:
 *   - the brand colour world as inline `--color-*` vars (per-mode via light-dark()),
 *     so canvas/surface/text/border become the brand's, plus the surface-container
 *     ramp composed from surface and subtle, so a design that fills a control from
 *     those roles (the Material input frame, the minimal secondary hover) takes the
 *     brand's tones while the design keeps the control's shape and states;
 *   - decorative background layers as `--sig-<key>-l` / `--sig-<key>-d` CSS values
 *     (grid, glow, card, panel) the host paints. url()/gradients can't use
 *     light-dark(), so each ships an explicit light + dark value the consumer
 *     resolves via the `.dark` class.
 */
export interface SignatureValue {
  /** The value used in light mode. */
  light: string;
  /** The value used in dark mode. */
  dark: string;
}

export interface Signature {
  id: string;
  name: string;
  /** Single hex anchoring the synthesized PRIMARY ramp (OKLCH, brand at step 600). */
  accent: string;
  fonts?: { display?: string; sans?: string; mono?: string };
  /** The family word of a lockup system (`digita` for `digita●platform`, `digita●erp`): the
   *  chrome renders `<family> ● <product>` from the display face for every product of the
   *  family instead of one wordmark SVG per product. Absent: the signature has no lockup
   *  family and its `wordmark` SVG is the brand. */
  family?: string;
  /** Self-contained inline SVG string for the brand mark: `fill="currentColor"`
   *  (inherits the accent via CSS `color`), viewBox preserved, NO width/height —
   *  the consumer sizes it via CSS. Used by the shell as the default-brand
   *  monogram when the tenant has not set a logo. */
  monogram?: string;
  /** Inline SVG wordmark lockup (self-contained, own colours) — the wide brand
   *  chrome variant; falls back to the app name text when absent. */
  wordmark?: string;
  /** The brand COLOUR WORLD: semantic token → {light,dark}. Written inline as
   *  `--color-<token>: light-dark(light, dark)`, so canvas/surface/text/border
   *  flip with the mode. Keys are theme token names (bg, surface, textMain, …).
 *  `surface` and `subtle` are six-digit hex per mode (`#RRGGBB`): the
 *  surface-container ramp composes from them and refuses any other form. */
  colors?: Record<string, SignatureValue>;
  /** Decorative BACKGROUND layers: key → {light,dark} CSS value (gradient/colour).
   *  Written as `--sig-<key>-l` / `--sig-<key>-d` for the keys the host paints:
   *  grid and glow (the shell backdrop), card (a card) and panel (the sign-in
   *  page). Any other key is written nowhere. */
  graphics?: Record<string, SignatureValue>;
}

// No baked signatures — every signature is now a DELIVERED free plugin
// (@digitaplatform/digita, registered at runtime via registerSignature). The
// theme keeps only this neutral NONE baseline as the pre-delivery token floor:
// it applies no accent / colour world, so the active design own tokens show
// through until a signature is delivered.
const NONE: Signature = { id: "none", name: "None", accent: "" };

export const SIGNATURES: Record<string, Signature> = {};

export const DEFAULT_SIGNATURE_ID = 'digita';

/** Resolve a signature id: a runtime-DELIVERED signature (plugin) wins, then a
 *  BAKED one, then the DEFAULT — resolved as a delivered signature too, because
 *  the default (digita) ships as a bundled plugin, not a baked entry. So a
 *  stale or unknown stored id still lands on the real default brand instead of
 *  the accent-less NONE floor. */
export function getSignature(id: string | null | undefined): Signature {
  const delivered = getRuntimeSignature(id);
  if (delivered) return delivered;
  if (id != null && SIGNATURES[id]) return SIGNATURES[id];
  return getRuntimeSignature(DEFAULT_SIGNATURE_ID) || SIGNATURES[DEFAULT_SIGNATURE_ID] || NONE;
}

// The token/graphic keys a signature may write — the fixed teardown set, so a
// switch to a thinner signature clears the previous one's world (no stale vars).
const SIGNATURE_COLOR_TOKENS = [
  'bg',
  'surface',
  'surfaceGlass',
  'subtle',
  'bgHover',
  'textMain',
  'textMuted',
  'border',
  'borderStrong',
  ...SURFACE_CONTAINER_ROLES,
] as const;
// The graphics the host paints. A signature writes no other: a var nothing paints
// shows nothing, and the teardown then clears exactly what was written.
const SIGNATURE_GRAPHIC_KEYS = ['grid', 'glow', 'card', 'panel'] as const;

/** Remove every signature-owned var + the data-signature stamp (clean teardown). */
export function resetSignature(target: HTMLElement = document.documentElement): void {
  target.removeAttribute('data-signature');
  for (const token of SIGNATURE_COLOR_TOKENS) target.style.removeProperty(cssVarName(token));
  for (const key of SIGNATURE_GRAPHIC_KEYS) {
    target.style.removeProperty(`--sig-${key}-l`);
    target.style.removeProperty(`--sig-${key}-d`);
  }
  // Also clear the branding layer a signature writes via applyBranding — the
  // accent ramp (--color-primary-*), the primary-container roles, and the
  // --font-* stacks — so switching to a thinner or accent-less signature leaves
  // no stale ramp or fonts behind (the caller re-asserts tenant branding, if
  // any, on top afterwards).
  resetBranding(target);
}

/**
 * The attributes and properties a signature writes. Always the accent ramp +
 * fonts (through the branding layer). A FULL signature additionally stamps
 * `data-signature` and writes its colour world (`--color-*` as light-dark()) and
 * decorative graphics (`--sig-*-l/-d`).
 */
export function signatureStyle(s: Signature): IdentityStyle {
  // A NONE / accent-less baseline passes null → no ramp override, so the active
  // design's own primary shows through (the token floor).
  const style = brandingStyle({ primary_color: s.accent || null, fonts: s.fonts });
  if (!s.colors && !s.graphics) return style;
  style.attributes['data-signature'] = s.id;
  if (s.colors) {
    // The container roles are surfaces too, so the signature owns them: composed
    // from surface and subtle first, then any role the signature names replaces
    // the composed value in the loop below.
    const { surface, subtle } = s.colors;
    if (surface && subtle) {
      const light = composeSurfaceContainerRamp(s.id, surface.light, subtle.light);
      const dark = composeSurfaceContainerRamp(s.id, surface.dark, subtle.dark);
      for (const role of SURFACE_CONTAINER_ROLES) {
        style.properties[cssVarName(role)] = `light-dark(${light[role]}, ${dark[role]})`;
      }
    }
    for (const [token, value] of Object.entries(s.colors)) {
      style.properties[cssVarName(token)] = `light-dark(${value.light}, ${value.dark})`;
    }
    // The primary colour on the page is measured on the signature's own canvas and surface.
    const { bg } = s.colors;
    const ramp = s.accent ? synthesizeRamp(s.accent) : null;
    if (ramp && bg && surface) {
      pageRoleProperties(ramp, { light: [bg.light, surface.light], dark: [bg.dark, surface.dark] }, style.properties);
    }
  }
  if (s.graphics) {
    for (const key of SIGNATURE_GRAPHIC_KEYS) {
      const value = s.graphics[key];
      if (!value) continue;
      style.properties[`--sig-${key}-l`] = value.light;
      style.properties[`--sig-${key}-d`] = value.dark;
    }
  }
  return style;
}

/**
 * Apply a signature's identity (see signatureStyle). Clears any previous
 * signature's world first, so switching signatures never leaves stale vars.
 */
export function applySignature(
  id: string | null | undefined,
  target: HTMLElement = document.documentElement,
): void {
  resetSignature(target);
  writeIdentityStyle(signatureStyle(getSignature(id)), target);
}

/** The localStorage key a person's own signature pick was kept under, before the tenant's
 *  look replaced it: nothing in the app or the website reads it, and bootIdentity removes it. */
export const SIGNATURE_STORAGE_KEY = 'digita-app:signature';

/** Remove a person's former signature pick from this browser. */
export function removeFormerSignaturePick(): void {
  try {
    localStorage.removeItem(SIGNATURE_STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode): nothing stored */
  }
}

/** The signature a frontend that keeps its own pick stored under `key`, else the default.
 *  A stored id is honoured as-is (it may be a DELIVERED signature not yet registered at
 *  this moment), and the default is the intended active signature (digita) — delivered,
 *  not baked. getSignature() resolves both to a real config (or the NONE floor) safely. */
export function resolveInitialSignature(key: string): string {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    if (stored) return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT_SIGNATURE_ID;
}
