/**
 * Mode-specific semantic tokens — the single definition of the :root (light) and
 * .dark CSS-variable blocks. Values are transcribed VERBATIM from the legacy
 * digita-ui public/theme/variables.css (the build-time equality guard in
 * gen-css.mjs asserts they still match, so the extraction can never silently
 * drift the original design). Keys are camelCase; gen-css + the preset map them
 * to --color-<kebab> via the single cssVarName() transform.
 */
export interface SemanticTokens {
  bg: string;
  surface: string;
  subtle: string;
  border: string;
  /** A genuinely-visible hairline for the rare true separation (table frame),
   *  keeping `border` itself near-invisible for resting separators. */
  borderStrong: string;
  /** Region/list-row/menu-item hover fill — kills border-only highlighting. */
  bgHover: string;
  /** Translucent floating-surface fill (menus/dialogs/command palette) paired
   *  with backdrop-blur. */
  surfaceGlass: string;
  /** M3 surface-container steps (P2.4) — a five-step monotonic tonal ramp from
   *  the page background toward elevated containers. Light: lowest ≈ white …
   *  highest slightly darker; dark: the tonal inverse (lowest darkest …
   *  highest lightest). Depth under Material comes from these + elevation, not
   *  glass; every design defines its own coherent neutral ramp. */
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  textMain: string;
  textMuted: string;
  error: string;
  errorLight: string;
  warning: string;
  warningLight: string;
  success: string;
  successLight: string;
  info: string;
  infoLight: string;
  /** Foreground (text/icon) that sits ON a primary-600 fill — button labels,
   *  checkbox tick. A design with a LIGHT primary overrides this to a dark value
   *  so the label stays legible (this is the token that replaces hardwired
   *  `text-white` in the shared kit). */
  onPrimary: string;
  /** Foreground that sits ON an error fill — destructive button labels. */
  onError: string;
  /** M3 tonal primary container (P3 color roles) — the soft brand-tinted fill
   *  behind tonal/secondary emphasis (tonal buttons, selected chips, FAB, nav
   *  pill). Light: a pale tint of the ACTIVE primary ramp (≈ primary-100);
   *  dark: a deep step of the same ramp (≈ primary-800). ADR-V2: the primary
   *  ramp belongs to the TINT layer, so this role is OPTIONAL for designs —
   *  gen-css emits it from the tint (default blue at :root, per-[data-tint]
   *  blocks) and runtime branding re-derives it for tenant brands. */
  primaryContainer?: string;
  /** Foreground that sits ON primaryContainer — readable dark primary in light
   *  (≈ primary-900), light primary in dark (≈ primary-100). Optional for
   *  designs (ADR-V2) — supplied by the tint layer like primaryContainer. */
  onPrimaryContainer?: string;
  /** The editor/selection accent — outlines, resize handles, snap guides, the
   *  selected-band ring. ADR-V2: derived from the ACTIVE primary via var()/
   *  color-mix so it follows the user's tint automatically; designs no longer
   *  override it (optional). Kills the off-brand generic selection colour. */
  selection?: string;
  /** A translucent tint of `selection` for soft/"linked" fills (sibling-instance
   *  outlines, hover wash) — sits legibly over any surface. Optional for
   *  designs (ADR-V2) — derived from the active primary via color-mix. */
  selectionSoft?: string;
}

export const semantic: { light: SemanticTokens; dark: SemanticTokens } = {
  light: {
    bg: '#FAF9F5',
    surface: '#FFFFFF',
    subtle: '#F2EFE8',
    border: '#E8E4DA',
    borderStrong: '#D9D4C7',
    bgHover: '#F4F0E7',
    surfaceGlass: 'rgba(255,255,255,0.72)',
    surfaceContainerLowest: '#FFFFFF',
    surfaceContainerLow: '#F7F5EF',
    surfaceContainer: '#F2EFE8',
    surfaceContainerHigh: '#ECE8DF',
    surfaceContainerHighest: '#E6E1D5',
    textMain: '#1F1D1A',
    textMuted: '#6F6A5F',
    error: '#dc2626',
    errorLight: '#fef2f2',
    warning: '#f59e0b',
    warningLight: '#fffbeb',
    success: '#10b981',
    successLight: '#ecfdf5',
    info: '#3b82f6',
    infoLight: '#eff6ff',
    onPrimary: '#FFFFFF',
    onError: '#FFFFFF',
    // ADR-V2: primaryContainer/onPrimaryContainer come from the TINT layer
    // (gen-css varsForTint — default blue at :root, per-[data-tint] blocks).
    // selection/selectionSoft derive from the ACTIVE primary so they follow
    // any tint with zero per-tint emission (light anchors on the solid 600
    // action step; the soft wash keeps the previous 12% alpha).
    selection: 'var(--color-primary-600)',
    selectionSoft: 'color-mix(in srgb, var(--color-primary-600) 12%, transparent)',
  },
  dark: {
    bg: '#171512',
    surface: '#1F1D19',
    subtle: '#26231E',
    border: '#35312A',
    borderStrong: '#494339',
    bgHover: 'rgba(255,250,240,0.05)',
    surfaceGlass: 'rgba(31,29,25,0.72)',
    surfaceContainerLowest: '#12100D',
    surfaceContainerLow: '#1B1915',
    surfaceContainer: '#201D19',
    surfaceContainerHigh: '#282520',
    surfaceContainerHighest: '#302D26',
    textMain: '#F1EEE6',
    textMuted: '#A39E92',
    error: '#f87171',
    errorLight: 'rgba(239,68,68,0.1)',
    warning: '#fbbf24',
    warningLight: 'rgba(245,158,11,0.1)',
    success: '#34d399',
    successLight: 'rgba(16,185,129,0.1)',
    info: '#60a5fa',
    infoLight: 'rgba(59,130,246,0.1)',
    onPrimary: '#FFFFFF',
    onError: '#FFFFFF',
    // ADR-V2: container roles from the tint layer (see the light block note).
    // Dark selection anchors on primary-400 (the legible step on dark
    // surfaces, matching the previous per-design dark values) at 24% for soft.
    selection: 'var(--color-primary-400)',
    selectionSoft: 'color-mix(in srgb, var(--color-primary-400) 24%, transparent)',
  },
};
