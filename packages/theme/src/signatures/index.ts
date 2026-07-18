import { applyBranding, resetBranding } from '../runtime/runtime.js';
import { cssVarName } from '../tokens/index.js';
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
 *     so canvas/surface/text/border become the brand's — the design's control
 *     skin still wins on buttons/inputs because those aren't touched here;
 *   - decorative background layers as `--sig-<key>-l` / `--sig-<key>-d` CSS values
 *     (grid, glow, band, card, panel) the shell backdrop paints. url()/gradients
 *     can't use light-dark(), so each ships an explicit light + dark value the
 *     consumer resolves via the `.dark` class.
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
  logoUrl?: string;
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
   *  flip with the mode. Keys are theme token names (bg, surface, textMain, …). */
  colors?: Record<string, SignatureValue>;
  /** Decorative BACKGROUND layers: key → {light,dark} CSS value (gradient/colour).
   *  Written as `--sig-<key>-l` / `--sig-<key>-d`; the shell backdrop composes
   *  them. Keys: grid, glow, band, card, panel. */
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
] as const;
const SIGNATURE_GRAPHIC_KEYS = ['grid', 'glow', 'band', 'card', 'panel'] as const;

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
 * Apply a signature's identity via the branding layer. Always sets the accent
 * ramp + fonts (applyBranding). A FULL signature additionally stamps
 * `data-signature` and writes its colour world (`--color-*` as light-dark()) and
 * decorative graphics (`--sig-*-l/-d`). Clears any previous signature's world
 * first, so switching signatures never leaves stale vars.
 */
export function applySignature(
  id: string | null | undefined,
  target: HTMLElement = document.documentElement,
): void {
  const s = getSignature(id);
  resetSignature(target);
  // A NONE / accent-less baseline passes null → no ramp override, so the active
  // design's own primary shows through (the token floor).
  applyBranding({ primary_color: s.accent || null, fonts: s.fonts }, target);
  if (!s.colors && !s.graphics) return;
  target.setAttribute('data-signature', s.id);
  if (s.colors) {
    for (const [token, value] of Object.entries(s.colors)) {
      target.style.setProperty(cssVarName(token), `light-dark(${value.light}, ${value.dark})`);
    }
  }
  if (s.graphics) {
    for (const [key, value] of Object.entries(s.graphics)) {
      target.style.setProperty(`--sig-${key}-l`, value.light);
      target.style.setProperty(`--sig-${key}-d`, value.dark);
    }
  }
}

/** Initial signature from localStorage, else the default. A stored id is honoured
 *  as-is (it may be a DELIVERED signature not yet registered at this moment), and
 *  the default is the intended active signature (digita) — delivered, not baked.
 *  getSignature() resolves both to a real config (or the NONE floor) safely. */
export function resolveInitialSignature(keyPrefix = 'digita-ui:signature'): string {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(keyPrefix) : null;
    if (stored) return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT_SIGNATURE_ID;
}
