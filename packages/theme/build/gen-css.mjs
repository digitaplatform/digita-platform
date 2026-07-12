// Generate dist/theme.css (the runtime layer: CSS-variable values light/dark +
// Inter @font-face + base resets) from the compiled token source, and copy the
// font files. Runs after `tsc`. A frozen equality guard asserts every legacy
// digita-ui variable still resolves to its original value, so the central
// extraction can never silently change the original design.
import { writeFileSync, mkdirSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { varsForMode, shadowVarsForMode, motionVars, borderRadius, fontFamily } from '../dist/index.js';
import { synthesizeRamp, RAMPS, TINT_PALETTES, DEFAULT_TINT_KEY, tintRamp, varsForTint } from '../dist/tokens/index.js';
import { varsForDesign, DESIGNS, getDesign, DEFAULT_DESIGN_ID } from '../dist/index.js';

// ── Build-time self-test for the brand-ramp synthesis ─────────────────────
// Feeding the DEFAULT primary-600 back in must reproduce the primary ramp
// near-identically (same hue + reference lightness curve ⇒ tiny rounding
// drift only). Fails the build loudly if the color math regresses.
{
  const synth = synthesizeRamp(RAMPS.primary['600']);
  if (!synth) throw new Error('[theme] synthesizeRamp rejected the default primary-600');
  const hexDist = (a, b) => {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    return (
      Math.abs(((pa >> 16) & 255) - ((pb >> 16) & 255)) +
      Math.abs(((pa >> 8) & 255) - ((pb >> 8) & 255)) +
      Math.abs((pa & 255) - (pb & 255))
    );
  };
  for (const [step, hex] of Object.entries(RAMPS.primary)) {
    const d = hexDist(synth[step], hex.toLowerCase());
    if (d > 12) {
      throw new Error(
        `[theme] ramp-synthesis self-test failed at step ${step}: ${synth[step]} vs ${hex} (Δ${d})`,
      );
    }
  }
  console.log('[theme] ramp-synthesis self-test passed (default primary reproduced).');
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const distDir = join(root, 'dist');
const fontsOut = join(distDir, 'fonts');
const fontsSrc = join(root, 'assets', 'fonts');

// ADR-V2 tint layer: designs are primary-less — the bare :root/.dark carry the
// DEFAULT tint (iOS blue #007AFF, itself a grid entry): the full synthesized
// --color-primary-* ramp + the mode-flipping container roles. Per-tint
// [data-tint] blocks below override them at equal specificity, later source.
const DEFAULT_TINT_RAMP = tintRamp(DEFAULT_TINT_KEY);

// Colors + per-mode shadows in each block; motion vars only in :root (they cascade
// into .dark unchanged). Dark gets its OWN, stronger shadows so depth registers.
const light = {
  ...varsForMode('light'),
  ...varsForTint(DEFAULT_TINT_RAMP, 'light'),
  ...shadowVarsForMode('light'),
  ...motionVars(),
  ...radiusFor(getDesign(DEFAULT_DESIGN_ID)),
  ...typoFor(getDesign(DEFAULT_DESIGN_ID)),
  ...categoricalFor(getDesign(DEFAULT_DESIGN_ID), 'light'),
};
const dark = {
  ...varsForMode('dark'),
  ...varsForTint(DEFAULT_TINT_RAMP, 'dark'),
  ...shadowVarsForMode('dark'),
  ...categoricalFor(getDesign(DEFAULT_DESIGN_ID), 'dark'),
};

// ── Per-design composition (Phase 1) ─────────────────────────────────────────
// A design's shadow/motion override the platform base; colors come from
// varsForDesign (design ramp override, else default). Radius/typography stay OUT
// of scope until Phase 5 (they are baked literals in the preset for now).
function shadowFor(d, mode) {
  return { ...shadowVarsForMode(mode), ...(d.shadow?.[mode] ?? {}) };
}
function motionFor(d) {
  return { ...motionVars(), ...(d.motion ?? {}) };
}
// Radius as vars (Phase 5a) so a design can re-shape (crisp vs pill) at runtime.
// Mode-agnostic → emitted in the light/:root block only (cascades into .dark).
// The preset references var(--radius-*); resolved value is identical for the
// default design, so existing apps are visually unchanged.
function radiusFor(d) {
  const r = { ...borderRadius, ...(d.radius ?? {}) };
  return {
    '--radius-input': r.input,
    '--radius-btn': r.btn,
    '--radius-card': r.card,
    '--radius-dialog': r.dialog,
  };
}
// Typography as vars (Phase 5b). A family with whitespace is quoted for CSS
// (unless already quoted). Mode-agnostic → light/:root block. The preset reads
// var(--font-*); resolves to the same stack for the default design.
function fontStack(arr) {
  return arr.map((f) => (/\s/.test(f) && !/^["']/.test(f) ? `"${f}"` : f)).join(', ');
}
function typoFor(d) {
  const t = { ...fontFamily, ...(d.typography ?? {}) };
  return {
    '--font-sans': fontStack(t.sans),
    '--font-display': fontStack(t.display),
    '--font-mono': fontStack(t.mono),
  };
}
// Categorical/identity palette — 8 hues per mode → --color-cat-1..8 plus a derived
// low-alpha --color-cat-N-soft (chip/tag backgrounds). Required in every design
// (coverage-guarded below); no platform default — identity colour is per-design.
function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
function categoricalFor(d, mode) {
  const out = {};
  d.categorical[mode].forEach((c, i) => {
    out[`--color-cat-${i + 1}`] = c;
    out[`--color-cat-${i + 1}-soft`] = hexToRgba(c, 0.14);
  });
  return out;
}
// Motion vars ride only in the light block (they cascade into .dark unchanged),
// mirroring the bare-block composition above.
function designLight(d) {
  return {
    ...varsForDesign(d, 'light'),
    ...shadowFor(d, 'light'),
    ...motionFor(d),
    ...radiusFor(d),
    ...typoFor(d),
    ...categoricalFor(d, 'light'),
  };
}
function designDark(d) {
  return { ...varsForDesign(d, 'dark'), ...shadowFor(d, 'dark'), ...categoricalFor(d, 'dark') };
}

function block(selector, vars) {
  const lines = Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  return `${selector} {\n${lines}\n}`;
}

// Static (non-token) base layer — transcribed verbatim from the legacy
// digita-ui public/theme/base.css. Font urls stay absolute /fonts/* (apps
// serve them from their public/fonts in Phase 1).
const BASE_CSS = `/* Self-hosted Inter font */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 300 700;
  font-display: swap;
  src: url('./fonts/Inter-latin-ext.woff2') format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 300 700;
  font-display: swap;
  src: url('./fonts/Inter-latin.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

/* Base resets */
html {
  font-size: 16px;
}
body {
  font-feature-settings: "cv11", "ss01";
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  -webkit-text-size-adjust: 100%;
  -moz-text-size-adjust: 100%;
  text-size-adjust: 100%;
}
* {
  border-color: var(--color-border);
}

/* Nordstern F1 · App-shell touch lock: no rubber-band overscroll, no sideways
   pan, no double-tap zoom delay. Pinch-zoom is disabled by the viewport meta. */
html { overscroll-behavior: none; touch-action: manipulation; }
body { overscroll-behavior: none; overflow-x: clip; }
#root { overflow-x: clip; }

/* Nordstern F9 · Native number spinners never render (grid steppers + arrow keys stay). */
[data-ui="input"][type="number"] { appearance: textfield; -moz-appearance: textfield; }
[data-ui="input"][type="number"]::-webkit-outer-spin-button,
[data-ui="input"][type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

/* Native controls (checkbox, date picker, select popup, scrollbar) follow the
   active mode — otherwise an unchecked checkbox stays white in dark mode. */
:root { color-scheme: light; }
.dark { color-scheme: dark; }

/* Scrollbar — thumbs ride the neutral ramp so tenant branding and future
   ramp tweaks reach them (they were the last hardcoded grays). */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--color-neutral-300); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--color-neutral-400); }
.dark ::-webkit-scrollbar-thumb { background: var(--color-neutral-700); }
.dark ::-webkit-scrollbar-thumb:hover { background: var(--color-neutral-600); }
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

/* Density mode — components read var(--density-pad/--density-gap); comfortable is
   the default, compact/spacious are opt-in via [data-density] on the app root. */
:root { --density-pad: 1.5rem; --density-gap: 0.75rem; --density-row: 36; }
[data-density="compact"] { --density-pad: 1rem; --density-gap: 0.5rem; --density-row: 32; }
[data-density="spacious"] { --density-pad: 2rem; --density-gap: 1rem; --density-row: 44; }

/* Paper tokens — the report/print CANVAS mimics the printed SHEET, so these are
   DESIGN- and MODE-agnostic on purpose (paper is always light, in every design
   AND in dark mode). This is the ONE deliberate exception to the per-design token
   rule — do NOT "fix" them to follow the active design; that would break print
   fidelity. Consumed only by the report designer's canvas chrome. */
:root {
  --color-paper: #FFFFFF;
  --color-paper-ink: #1F1D1A;
  --color-paper-muted: #6F6A5F;
  --color-paper-guide: rgba(31,29,26,0.14);
}

/* Overlay entrance (menus / popovers / command palette / sheets) — opt in with
   class="anim-pop-in"; reduced-motion collapses it below. */
@keyframes anim-pop-in {
  from { opacity: 0; transform: translateY(4px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.anim-pop-in { animation: anim-pop-in var(--duration-slow) var(--ease-spring); }

/* Overlay exit — the reverse of anim-pop-in; consumers keep the node mounted
   for ~160ms after close so the exit can play (reduced-motion collapses it). */
@keyframes anim-pop-out {
  from { opacity: 1; transform: translateY(0) scale(1); }
  to { opacity: 0; transform: translateY(4px) scale(0.98); }
}
.anim-pop-out { animation: anim-pop-out var(--duration-base) var(--ease-in) forwards; }

/* Toast entrance — slides up from the notification edge with the spring ease;
   together with anim-pop-in this is the platform's motion vocabulary. */
@keyframes anim-toast-in {
  from { opacity: 0; transform: translateY(12px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.anim-toast-in { animation: anim-toast-in var(--duration-slow) var(--ease-spring); }

/* Bottom-sheet entrance/exit — slide from the bottom edge (used by the Sheet /
   BaseDialog presentation="sheet" and the iOS responsive mobile sheet). */
@keyframes anim-sheet-in { from { transform: translateY(100%); } to { transform: translateY(0); } }
@keyframes anim-sheet-out { from { transform: translateY(0); } to { transform: translateY(100%); } }

/* Blocked/invalid-action shake — a short horizontal nudge (a few px each way,
   ~150ms via --duration-base). Re-trigger by re-mounting or toggling the class. */
@keyframes anim-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-4px); }
  45% { transform: translateX(4px); }
  70% { transform: translateX(-2px); }
}
.anim-shake { animation: anim-shake var(--duration-base) var(--ease-smooth); }

/* Landing-confirmation glow — a ring pulse in currentColor (override via
   --glow-color) that expands and fades out. End state equals no shadow, so no
   fill-mode is needed; plays once on the element that received the drop/save. */
@keyframes anim-glow {
  from { box-shadow: 0 0 0 0 var(--glow-color, currentColor); }
  to { box-shadow: 0 0 0 8px transparent; }
}
.anim-glow { animation: anim-glow calc(var(--duration-slow) * 2) var(--ease-smooth); }

/* Accessibility: collapse motion (transforms still apply, instantly). */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`;

// The DEFAULT design paints the bare :root / .dark (byte-identical to pre-plugin
// output, the equality-guard target). EVERY design (incl. the default) also emits
// a scoped :root[data-design="id"] / ...].dark pair. Attribute specificity (0,1,1)
// beats bare :root (0,0,1): a set data-design wins, an unset one falls through to
// the bare default → no first-paint flash, existing apps (no attribute) unchanged.
const scoped = [];
for (const d of Object.values(DESIGNS)) {
  scoped.push(
    block(`:root[data-design="${d.meta.id}"]`, designLight(d)),
    block(`:root[data-design="${d.meta.id}"].dark`, designDark(d)),
  );
}

// ── Tint layer (ADR-V2) — one :root[data-tint="<key>"] / ...].dark pair per
//    grid entry, AFTER the design blocks: same specificity (0,1,1) as a design
//    light block but later in the source, so a set data-tint wins the primary
//    vars over the (primary-less) design blocks and the bare :root; the .dark
//    pair (0,2,1) re-flips the container roles exactly like the design blocks
//    handle mode. Tenant branding (inline style) still beats everything. ──
const tintBlocks = [];
for (const [key] of Object.entries(TINT_PALETTES)) {
  const ramp = tintRamp(key);
  tintBlocks.push(
    block(`:root[data-tint="${key}"]`, varsForTint(ramp, 'light')),
    block(`:root[data-tint="${key}"].dark`, varsForTint(ramp, 'dark')),
  );
}

// ── Component-variant layer — platform-specific component BEHAVIOR a design opts
//    into via meta.variant (→ data-design-variant on <html>, set by applyDesign).
//    Pure CSS keyed on the stable [data-ui] hook the primitives expose — no JS
//    branching in the kit. Sourced from build/variants/{base,ios,material}.css so
//    the growing layer stays maintainable (order: base → ios → material). ──
const variantsDir = join(here, 'variants');
const VARIANT_CSS = ['base.css', 'ios.css', 'material.css', 'editorial.css', 'fluent.css', 'minimal.css']
  .map((f) => readFileSync(join(variantsDir, f), 'utf8').trimEnd())
  .join('\n\n');

const css =
  `/* GENERATED by @digitaplatform/theme/build/gen-css.mjs — do not edit by hand. */\n\n` +
  [block(':root', light), block('.dark', dark), ...scoped, ...tintBlocks, BASE_CSS, VARIANT_CSS].join('\n\n') +
  '\n';

mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, 'theme.css'), css);

mkdirSync(fontsOut, { recursive: true });
for (const f of ['Inter-latin.woff2', 'Inter-latin-ext.woff2']) {
  const src = join(fontsSrc, f);
  if (existsSync(src)) copyFileSync(src, join(fontsOut, f));
  else console.warn(`[theme] WARNING: font not found at ${src}`);
}

// ── Equality guard — re-baselined to the INK & LEDGER identity (ADR-V1), then
//    the --color-primary-* / container entries re-baselined AGAIN for the ADR-V2
//    tint decoupling: the bare-:root default primary is now the BLUE default
//    tint = synthesizeRamp('#007AFF') (container roles: ramp 100/900 light,
//    800/100 dark). Every NON-primary entry is byte-identical to the ADR-V1
//    baseline. An INTENTIONAL token change must update EXPECTED here too, or
//    the build fails; the guard catches UNINTENDED drift from the chosen design. ──
const EXPECTED = {
  light: {
    '--color-bg': '#FAF9F5', '--color-surface': '#FFFFFF', '--color-subtle': '#F2EFE8', '--color-border': '#E8E4DA',
    '--color-border-strong': '#D9D4C7', '--color-bg-hover': '#F4F0E7', '--color-surface-glass': 'rgba(255,255,255,0.72)',
    '--color-surface-container-lowest': '#FFFFFF', '--color-surface-container-low': '#F7F5EF', '--color-surface-container': '#F2EFE8',
    '--color-surface-container-high': '#ECE8DF', '--color-surface-container-highest': '#E6E1D5',
    '--color-text-main': '#1F1D1A', '--color-text-muted': '#6F6A5F',
    '--color-error': '#dc2626', '--color-error-light': '#fef2f2', '--color-warning': '#f59e0b', '--color-warning-light': '#fffbeb',
    '--color-success': '#10b981', '--color-success-light': '#ecfdf5', '--color-info': '#3b82f6', '--color-info-light': '#eff6ff',
    '--color-on-primary': '#FFFFFF', '--color-on-error': '#FFFFFF',
    '--color-primary-container': '#cfe6ff', '--color-on-primary-container': '#002f74',
    '--color-primary-50': '#e9f5ff', '--color-primary-100': '#cfe6ff', '--color-primary-200': '#a4cdff', '--color-primary-300': '#6badff',
    '--color-primary-400': '#0d87ff', '--color-primary-500': '#006ed3', '--color-primary-600': '#007aff', '--color-primary-700': '#00499d',
    '--color-primary-800': '#003b87', '--color-primary-900': '#002f74', '--color-primary-950': '#031c47',
  },
  dark: {
    '--color-bg': '#171512', '--color-surface': '#1F1D19', '--color-subtle': '#26231E', '--color-border': '#35312A',
    '--color-border-strong': '#494339', '--color-bg-hover': 'rgba(255,250,240,0.05)', '--color-surface-glass': 'rgba(31,29,25,0.72)',
    '--color-surface-container-lowest': '#12100D', '--color-surface-container-low': '#1B1915', '--color-surface-container': '#201D19',
    '--color-surface-container-high': '#282520', '--color-surface-container-highest': '#302D26',
    '--color-text-main': '#F1EEE6', '--color-text-muted': '#A39E92',
    '--color-error': '#f87171', '--color-error-light': 'rgba(239,68,68,0.1)', '--color-warning': '#fbbf24', '--color-warning-light': 'rgba(245,158,11,0.1)',
    '--color-success': '#34d399', '--color-success-light': 'rgba(16,185,129,0.1)', '--color-info': '#60a5fa', '--color-info-light': 'rgba(59,130,246,0.1)',
    '--color-on-primary': '#FFFFFF', '--color-on-error': '#FFFFFF',
    '--color-primary-container': '#003b87', '--color-on-primary-container': '#cfe6ff',
    '--color-primary-50': '#e9f5ff', '--color-primary-100': '#cfe6ff', '--color-primary-200': '#a4cdff', '--color-primary-300': '#6badff',
    '--color-primary-400': '#0d87ff', '--color-primary-500': '#006ed3', '--color-primary-600': '#007aff', '--color-primary-700': '#00499d',
    '--color-primary-800': '#003b87', '--color-primary-900': '#002f74', '--color-primary-950': '#031c47',
  },
};

const offenders = [];
for (const mode of ['light', 'dark']) {
  const gen = mode === 'light' ? light : dark;
  for (const [k, v] of Object.entries(EXPECTED[mode])) {
    if (gen[k] !== v) offenders.push(`${mode} ${k}: expected ${v}, got ${gen[k] ?? '(missing)'}`);
  }
}
if (offenders.length) {
  console.error('[theme] EQUALITY GUARD FAILED — token edit drifted from the original design:\n  ' + offenders.join('\n  '));
  process.exit(1);
}

// ── Coverage guard — every design MUST define all semantic keys × 2 modes, so an
//    incomplete design can never ship a half-painted surface (fails the build loud).
//    ADR-V2: the tint-derived keys are EXEMPT — designs must NOT define them
//    (primaryContainer/onPrimaryContainer come from the tint layer; selection/
//    selectionSoft derive from the active primary via var()/color-mix in the
//    default semantic and cascade design-agnostically). ──
const TINT_DERIVED_KEYS = new Set(['primaryContainer', 'onPrimaryContainer', 'selection', 'selectionSoft']);
const SEMANTIC_KEYS = Object.keys(getDesign(DEFAULT_DESIGN_ID).semantic.light).filter(
  (k) => !TINT_DERIVED_KEYS.has(k),
);
const missing = [];
for (const d of Object.values(DESIGNS)) {
  for (const mode of ['light', 'dark']) {
    const sem = d.semantic?.[mode] ?? {};
    for (const k of SEMANTIC_KEYS) if (!(k in sem)) missing.push(`${d.meta.id}.${mode}.${k}`);
  }
}
if (missing.length) {
  console.error('[theme] DESIGN COVERAGE GUARD FAILED — designs missing semantic keys:\n  ' + missing.join('\n  '));
  process.exit(1);
}

// ── Categorical coverage guard — every design MUST define EXACTLY 8 identity
//    colours per mode (no silent platform default). ──
const missingCat = [];
for (const d of Object.values(DESIGNS)) {
  for (const mode of ['light', 'dark']) {
    const cats = d.categorical?.[mode];
    if (!Array.isArray(cats) || cats.length !== 8) {
      missingCat.push(`${d.meta.id}.${mode} (${Array.isArray(cats) ? cats.length : 'missing'}/8)`);
    }
  }
}
if (missingCat.length) {
  console.error('[theme] CATEGORICAL COVERAGE GUARD FAILED — need exactly 8 cat colours per mode:\n  ' + missingCat.join('\n  '));
  process.exit(1);
}

console.log(
  `[theme] theme.css written (${Object.keys(light).length} vars/mode, ${Object.keys(DESIGNS).length} design(s), ${Object.keys(TINT_PALETTES).length} tint(s)) + fonts copied; equality + coverage guards passed.`,
);
