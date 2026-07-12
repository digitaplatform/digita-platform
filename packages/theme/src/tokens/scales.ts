/**
 * Non-color scales — the "weightless" design language. Fonts + spacing rhythm +
 * radius + shadow + motion + tracking. Shadows and motion are exposed as CSS
 * variables (emitted per-mode by gen-css) so dark mode gets its OWN, stronger
 * shadows and raw CSS/keyframes can read the same easing/duration tokens; the
 * maps below are the Tailwind-facing half that reference those vars. Spacing /
 * radius / tracking are mode-agnostic literals.
 */
export const fontFamily = {
  // 'Twemoji Country Flags' resolves only where digita-ui registers the
  // @font-face (flag-glyphs-only woff2, Windows Chrome ships no flag emoji);
  // everywhere else the unknown family falls through to Inter harmlessly.
  sans: ['Twemoji Country Flags', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
  // INK & LEDGER display face (ADR-V1) — Fraunces (variable serif; self-hosting the
  // woff2 is a follow-up), with Georgia as the in-box serif fallback so the editorial
  // character survives without a webfont. Used for headings/record titles via `font-display`.
  display: ['Fraunces', 'Georgia', 'Times New Roman', 'serif'],
  mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
} as const;

/** Named spacing intent layer (added ALONGSIDE Tailwind's numeric scale): p-md,
 *  gap-lg, space-y-xl … carry meaning instead of magic numbers. */
export const spacing = {
  xxs: '0.25rem',
  xs: '0.5rem',
  sm: '0.75rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2rem',
  '2xl': '3rem',
  '3xl': '4rem',
} as const;

/** Radius differentiated by element class — the contrast (crisp inputs vs softer
 *  cards) is what kills the uniform-box feel. Additive: Tailwind's sm/md/lg stay. */
export const borderRadius = {
  input: '0.375rem', // 6 — inputs/selects/chips: tight, precise
  btn: '0.625rem', // 10 — buttons
  card: '0.875rem', // 14 — cards/sections: INK & LEDGER book-like softness
  dialog: '1.125rem', // 18 — dialogs/sheets/command palette
} as const;

export const letterSpacing = {
  tight: '-0.011em', // headings / record titles
  normal: '0',
  wide: '0.04em', // uppercase micro-labels
} as const;

/** Soft, layered elevation — references the per-mode --shadow-* vars (gen-css).
 *  Base surfaces are flat (none); only floating things get elevation. The legacy
 *  soft/hover names alias to sm/md for one release so nothing breaks mid-migration. */
export const boxShadow = {
  none: 'none',
  xs: 'var(--shadow-xs)',
  sm: 'var(--shadow-sm)',
  md: 'var(--shadow-md)',
  lg: 'var(--shadow-lg)',
  focus: 'var(--shadow-focus)',
  soft: 'var(--shadow-sm)',
  hover: 'var(--shadow-md)',
} as const;

/** Layering tokens for floating surfaces. The three layers the interaction
 *  foundation needs for now (popover < dialog < toast — toasts must render over
 *  open dialogs); rolling the remaining ad-hoc z-indexes (drawer, palette,
 *  tooltip) onto tokens is design-system work (TP3). */
export const zIndex = {
  popover: '40',
  dialog: '50',
  toast: '60',
} as const;

/** The typographic hierarchy — the missing half of the type system (fonts and
 *  tracking existed, SIZES did not, so every page title was a flat `text-xl`).
 *  Six intent-named steps; weight/tracking ride along per step so a single
 *  `text-h1` sets the whole treatment. Numbers stay Tailwind-compatible tuples. */
export const fontSize = {
  display: ['1.75rem', { lineHeight: '2.125rem', letterSpacing: '-0.02em', fontWeight: '600' }],
  h1: ['1.375rem', { lineHeight: '1.75rem', letterSpacing: '-0.011em', fontWeight: '600' }],
  h2: ['1.0625rem', { lineHeight: '1.5rem', fontWeight: '600' }],
  body: ['0.875rem', { lineHeight: '1.25rem' }],
  caption: ['0.75rem', { lineHeight: '1rem' }],
  micro: ['0.6875rem', { lineHeight: '0.875rem' }],
} as const;

export const transitionDuration = {
  fast: 'var(--duration-fast)',
  base: 'var(--duration-base)',
  slow: 'var(--duration-slow)',
} as const;

export const transitionTimingFunction = {
  smooth: 'var(--ease-smooth)', // hover/focus/color/opacity — snappy, no overshoot
  spring: 'var(--ease-spring)', // press-release + popover slide — tactile settle
  in: 'var(--ease-in)', // exits / fade-outs
} as const;

// ── The raw CSS-variable VALUES emitted by gen-css (the runtime half) ──────────
// Per-mode so depth registers on dark backgrounds (light shadows would vanish).
export const shadowValues: { light: Record<string, string>; dark: Record<string, string> } = {
  light: {
    // Warm shadows (INK & LEDGER) — cool blue-grey shadows read as dirty on warm bone.
    '--shadow-xs': '0 1px 2px rgba(60,50,25,0.05)',
    '--shadow-sm': '0 1px 3px rgba(60,50,25,0.07), 0 1px 2px rgba(60,50,25,0.05)',
    '--shadow-md': '0 4px 12px rgba(60,50,25,0.09), 0 2px 4px rgba(60,50,25,0.05)',
    '--shadow-lg': '0 12px 28px rgba(60,50,25,0.12), 0 4px 8px rgba(60,50,25,0.06)',
    // ADR-V2: the focus ring derives from the ACTIVE primary (tint layer) via
    // color-mix — same 20% strength as the previous literal — so it follows
    // any tint with zero per-tint emission. Designs no longer override it.
    '--shadow-focus': '0 0 0 3px color-mix(in srgb, var(--color-primary-600) 20%, transparent)',
  },
  dark: {
    '--shadow-xs': '0 1px 2px rgba(0,0,0,0.40)',
    '--shadow-sm': '0 1px 3px rgba(0,0,0,0.50), 0 1px 2px rgba(0,0,0,0.40)',
    '--shadow-md': '0 4px 12px rgba(0,0,0,0.55), 0 2px 4px rgba(0,0,0,0.40)',
    '--shadow-lg': '0 12px 28px rgba(0,0,0,0.60), 0 4px 8px rgba(0,0,0,0.45)',
    // ADR-V2: dark focus anchors on primary-400 (the step legible on dark
    // surfaces, matching the previous hand-picked literal) at the same 32%.
    '--shadow-focus': '0 0 0 3px color-mix(in srgb, var(--color-primary-400) 32%, transparent)',
  },
};

/** Mode-agnostic motion vars (emitted into :root) so keyframes + reduced-motion
 *  CSS read the same durations/easings as the Tailwind utilities. */
export const motionValues: Record<string, string> = {
  '--duration-fast': '75ms',
  '--duration-base': '150ms',
  '--duration-slow': '250ms',
  '--ease-smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
  '--ease-spring': 'cubic-bezier(0.16, 1, 0.3, 1)',
  '--ease-in': 'cubic-bezier(0.4, 0, 1, 1)',
};
