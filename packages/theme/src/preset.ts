import {
  cssVarName,
  RAMPS,
  fontSize,
  boxShadow,
  spacing,
  letterSpacing,
  zIndex,
  transitionDuration,
  transitionTimingFunction,
} from './tokens/index.js';

/**
 * The Digita Tailwind PRESET — the build-time half of the design system. Every
 * app does `presets: [digitaTheme]` so all token utilities (bg-primary-600,
 * text-textMain, bg-error, neutral-*, accent-*, …) resolve to the SAME
 * --color-* variables that @digitaplatform/theme/theme.css defines at runtime. Built
 * from the token source via the shared cssVarName() transform, so a utility and
 * its variable can never drift. Reproduces the block previously copy-pasted in
 * every app's tailwind.config (+ adds neutral / accent).
 */
function v(token: string): string {
  return `var(${cssVarName(token)})`;
}

function ramp(name: string): Record<string, string> {
  return Object.fromEntries(Object.keys(RAMPS[name] ?? {}).map((step) => [step, v(`${name}-${step}`)]));
}

const preset = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: v('bg'),
        surface: v('surface'),
        surfaceGlass: v('surfaceGlass'),
        // M3 surface-container steps (P2.4) → bg-surfaceContainer,
        // bg-surfaceContainer-lowest/-low/-high/-highest.
        surfaceContainer: {
          DEFAULT: v('surfaceContainer'),
          lowest: v('surfaceContainerLowest'),
          low: v('surfaceContainerLow'),
          high: v('surfaceContainerHigh'),
          highest: v('surfaceContainerHighest'),
        },
        subtle: v('subtle'),
        border: v('border'),
        borderStrong: v('borderStrong'),
        bgHover: v('bgHover'),
        textMain: v('textMain'),
        textMuted: v('textMuted'),
        onPrimary: v('onPrimary'),
        onError: v('onError'),
        // M3 tonal primary-container roles (P3) → bg-primaryContainer,
        // text-onPrimaryContainer; branding re-derives both at runtime.
        primaryContainer: v('primaryContainer'),
        onPrimaryContainer: v('onPrimaryContainer'),
        // Editor selection accent (per-design) + the design/mode-agnostic paper
        // tokens for the report/print canvas.
        selection: { DEFAULT: v('selection'), soft: v('selectionSoft') },
        paper: {
          DEFAULT: v('paper'),
          ink: v('paperInk'),
          muted: v('paperMuted'),
          guide: v('paperGuide'),
        },
        // Categorical identity palette → bg-cat-1..8 + bg-cat-1-soft..8-soft.
        cat: Object.fromEntries(
          Array.from({ length: 8 }, (_, i) => i + 1).flatMap((n) => [
            [String(n), v(`cat-${n}`)],
            [`${n}-soft`, v(`cat-${n}-soft`)],
          ]),
        ),
        primary: ramp('primary'),
        neutral: ramp('neutral'),
        accent: ramp('accent'),
        error: { DEFAULT: v('error'), light: v('errorLight') },
        warning: { DEFAULT: v('warning'), light: v('warningLight') },
        success: { DEFAULT: v('success'), light: v('successLight') },
        info: { DEFAULT: v('info'), light: v('infoLight') },
      },
      // Font stacks via CSS vars (Phase 5b) so a design re-fonts at runtime.
      // Resolves to the same stack for the default design.
      fontFamily: {
        sans: 'var(--font-sans)',
        display: 'var(--font-display)',
        mono: 'var(--font-mono)',
      },
      fontSize,
      boxShadow,
      spacing,
      // Radius via CSS vars (Phase 5a) so a design re-shapes at runtime. Resolves
      // to the same value for the default design → existing apps unchanged. The
      // Tailwind sm/md/lg/full defaults stay (extend merges).
      borderRadius: {
        input: 'var(--radius-input)',
        btn: 'var(--radius-btn)',
        card: 'var(--radius-card)',
        dialog: 'var(--radius-dialog)',
      },
      letterSpacing,
      zIndex,
      transitionDuration,
      transitionTimingFunction,
    },
  },
};

export default preset;
