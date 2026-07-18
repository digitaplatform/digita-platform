import { applyBranding } from '../runtime/runtime.js';
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

// The simetrix "X" monogram, extracted from the marketing site's inline
// <symbol id="csx"> (viewBox 0 0 407 556) — hand-drawn strokes forming the X.
const SIMETRIX_MONOGRAM =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 407 556" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M272.5 3L276.5 3L275.5 8L217 221.5L205.5 189ZM309.5 3L313 2.5L313.5 5L265.5 183L235 213.5ZM235.5 10L236.5 14L197.5 160L196 162.5L179 161.5L229.5 20ZM345.5 11L348 10.5L348.5 14L309.5 160L291 161.5ZM193.5 26L194.5 30L160.5 160L142 161.5L188.5 33ZM377.5 27L380.5 30L346.5 161L328 161.5ZM140.5 163L148.5 180L151.5 195L130.5 275L104.5 346L74 376.5L98.5 276ZM344.5 165L317.5 274L276 383.5L265.5 351L285.5 275L315.5 194ZM159.5 215L173.5 249L168.5 270L162.5 287L125 324.5L136.5 277ZM292.5 217L293.5 220L279.5 273L257 331.5L243.5 295L247.5 280L257.5 252ZM241.5 269L239 280.5L236.5 274ZM199.5 324L211.5 353L211.5 358L145.5 542L143.5 547L140 547.5ZM183.5 327L185.5 327L106.5 547L103 547.5L152.5 359ZM220.5 383L222.5 383L226 393.5L235.5 395L183.5 538L180 540.5L179.5 536ZM124.5 387L124.5 392L72.5 535L68 539.5L105.5 394L118 393.5ZM68.5 394L86.5 394L38 523.5L35.5 520ZM254.5 394L272.5 395L227.5 517L222 524.5Z"/></svg>';

// The digita "cloud" monogram — the rounded cloud glyph carried in the nav tile
// of digitacloud.app; single-tint so it inherits the accent via currentColor.
const DIGITA_MONOGRAM =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 19a4.5 4.5 0 0 1-.62-8.96 6 6 0 0 1 11.55-1.1A4.75 4.75 0 0 1 17.25 19H7Z"/></svg>';

// The digita wordmark lockup — "digita" + a glowing accent dot, mirroring the
// nav lockup (Space Grotesk 600, -.03em) with the site's cyan glow on the dot.
const DIGITA_WORDMARK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 132 28" fill="none" aria-hidden="true"><text x="0" y="21" font-family="\'Space Grotesk\',sans-serif" font-weight="600" font-size="22" letter-spacing="-.6" fill="currentColor">digita</text><circle cx="78" cy="20" r="3.4" fill="#8FDBFF"><animate attributeName="opacity" values="1;.6;1" dur="2.4s" repeatCount="indefinite"/></circle></svg>';

const simetrix: Signature = {
  id: 'simetrix',
  name: 'Simetrix',
  accent: '#0E6FB8',
  fonts: {
    display: "'Space Grotesk', 'Inter', system-ui, sans-serif",
    sans: "'Manrope', 'Inter', system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
  },
  monogram: SIMETRIX_MONOGRAM,
};

/**
 * digita — the platform's own identity, reproduced from digitacloud.app: cool
 * navy canvas, cyan hero accent, the 40px grid + top radial glow, and the cloud
 * mark + wordmark. The FULL brand world (colours + graphics), so digita-ui
 * rendered with it belongs to the digitacloud.app / digitaplatform.com world.
 */
const digita: Signature = {
  id: 'digita',
  name: 'Digita',
  // Mid brand-blue anchors the ramp so it reads in BOTH modes; the hero cyan
  // (#8FDBFF) lives in the glow/graphics layer, not the control accent.
  accent: '#3896E6',
  fonts: {
    display: "'Space Grotesk', 'Inter', system-ui, sans-serif",
    sans: "'Manrope', 'Inter', system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
  },
  monogram: DIGITA_MONOGRAM,
  wordmark: DIGITA_WORDMARK,
  colors: {
    bg: { light: '#F5F8FB', dark: '#050B14' },
    surface: { light: '#FFFFFF', dark: '#0B1524' },
    surfaceGlass: { light: 'rgba(255,255,255,.72)', dark: 'rgba(11,21,36,.60)' },
    subtle: { light: '#F0F5FA', dark: '#0A1420' },
    bgHover: { light: 'rgba(20,60,110,.06)', dark: 'rgba(120,180,240,.06)' },
    textMain: { light: '#0D1B2A', dark: '#EAF1F8' },
    textMuted: { light: '#4A6076', dark: '#8FA3B6' },
    border: { light: 'rgba(15,50,90,.10)', dark: 'rgba(255,255,255,.08)' },
    borderStrong: { light: 'rgba(15,50,90,.18)', dark: 'rgba(120,180,240,.20)' },
  },
  graphics: {
    // 40px line grid — the site's own two linear-gradients (sharper than an SVG tile).
    grid: {
      light:
        'linear-gradient(rgba(20,70,130,.055) 1px, transparent 1px), linear-gradient(90deg, rgba(20,70,130,.055) 1px, transparent 1px)',
      dark: 'linear-gradient(rgba(120,180,240,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(120,180,240,.05) 1px, transparent 1px)',
    },
    // Top-left radial glow behind the chrome.
    glow: {
      light: 'radial-gradient(90% 120% at 20% -5%, rgba(56,150,230,.10) 0%, transparent 55%)',
      dark: 'radial-gradient(90% 120% at 20% -5%, rgba(56,150,230,.16) 0%, transparent 55%)',
    },
    // Full-bleed section band.
    band: { light: '#F0F5FA', dark: '#03070d' },
    // Raised card / KPI tile gradient.
    card: {
      light: 'linear-gradient(155deg, #FFFFFF, #EEF4FA)',
      dark: 'linear-gradient(155deg, rgba(22,58,95,.55), rgba(11,31,51,.35))',
    },
    // CTA / login panel: radial glow over a deep navy gradient.
    panel: {
      light:
        'radial-gradient(80% 140% at 50% 0%, rgba(56,150,230,.12), transparent 60%), linear-gradient(160deg,#FFFFFF,#E9F1F9)',
      dark: 'radial-gradient(80% 140% at 50% 0%, rgba(56,150,230,.28), transparent 60%), linear-gradient(160deg,#0d2743,#060d16)',
    },
  },
};

export const SIGNATURES: Record<string, Signature> = { digita, simetrix };

export const DEFAULT_SIGNATURE_ID = 'digita';

export const SIGNATURE_LIST = Object.values(SIGNATURES).map((s) => ({ id: s.id, name: s.name }));

/** Resolve a signature id: a runtime-DELIVERED signature (plugin) wins, then a
 *  BAKED one, else the default. So the host applies the delivered brand world
 *  and the shell chrome reads the delivered monogram/wordmark. */
export function getSignature(id: string | null | undefined): Signature {
  const delivered = getRuntimeSignature(id);
  if (delivered) return delivered;
  return (id != null && SIGNATURES[id]) || SIGNATURES[DEFAULT_SIGNATURE_ID]!;
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
  applyBranding({ primary_color: s.accent, fonts: s.fonts }, target);
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

/** Initial signature from localStorage, validated against SIGNATURES; else the default. */
export function resolveInitialSignature(keyPrefix = 'digita-ui:signature'): string {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(keyPrefix) : null;
    if (stored && stored in SIGNATURES) return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT_SIGNATURE_ID;
}
