import type { Design } from '../types.js';

/**
 * MINIMAL — Geist / shadcn (Vercel) neutral system: pure white and near-black
 * zinc surfaces, hairline borders, tight radii, flat shadows and fast, sober
 * motion. No decorative color anywhere — the tint layer supplies the ONLY
 * chromatic moment. For dense admin/dev tools where the content is the UI.
 */
const ZINC = {
  50: '#FAFAFA', 100: '#F4F4F5', 200: '#E4E4E7', 300: '#D4D4D8', 400: '#A1A1AA',
  500: '#71717A', 600: '#52525B', 700: '#3F3F46', 800: '#27272A', 900: '#18181B', 950: '#09090B',
};

// Restrained cool-gray "accent" — minimal has no loud accent color; accent
// moments stay quiet slate while the tint layer owns primary (no COLOR_PALETTES
// chromatic ramp fits a neutral system, so the accent is defined inline).
const SLATE_ACCENT = {
  50: '#F8FAFC', 100: '#F1F5F9', 200: '#E2E8F0', 300: '#CBD5E1', 400: '#94A3B8',
  500: '#64748B', 600: '#475569', 700: '#334155', 800: '#1E293B', 900: '#0F172A', 950: '#020617',
};

const minimal: Design = {
  meta: {
    id: 'minimal',
    name: 'Minimal',
    description: 'Geist/shadcn — pure neutral zinc, hairline borders, tight radii, flat surfaces.',
    variant: 'minimal',
  },
  semantic: {
    light: {
      bg: '#FFFFFF', surface: '#FFFFFF', subtle: '#F4F4F5', border: '#E4E4E7', borderStrong: '#D4D4D8',
      bgHover: '#F4F4F5', surfaceGlass: 'rgba(255,255,255,0.72)',
      // Surface-container steps (P2.4) — deliberately compressed white → zinc-100:
      // minimal keeps elevation nearly flat; borders do the separating.
      surfaceContainerLowest: '#FFFFFF', surfaceContainerLow: '#FAFAFA', surfaceContainer: '#F6F6F7',
      surfaceContainerHigh: '#F4F4F5', surfaceContainerHighest: '#EFEFF1',
      textMain: '#09090B', textMuted: '#71717A',
      error: '#DC2626', errorLight: '#FEF2F2', warning: '#D97706', warningLight: '#FFFBEB',
      success: '#16A34A', successLight: '#F0FDF4', info: '#2563EB', infoLight: '#EFF6FF',
      onPrimary: '#FFFFFF', onError: '#FFFFFF',
      // ADR-V2: primaryContainer/onPrimaryContainer/selection/selectionSoft
      // come from the tint layer (design is primary-less).
    },
    dark: {
      bg: '#09090B', surface: '#18181B', subtle: '#27272A', border: '#27272A', borderStrong: '#3F3F46',
      bgHover: 'rgba(255,255,255,0.06)', surfaceGlass: 'rgba(24,24,27,0.72)',
      // Surface-container steps (P2.4) — tight zinc steps just above bg;
      // container sits on the surface value so cards stay flat.
      surfaceContainerLowest: '#0C0C0E', surfaceContainerLow: '#121214', surfaceContainer: '#18181B',
      surfaceContainerHigh: '#1E1E21', surfaceContainerHighest: '#232326',
      textMain: '#FAFAFA', textMuted: '#A1A1AA',
      error: '#F87171', errorLight: 'rgba(220,38,38,0.15)', warning: '#FBBF24', warningLight: 'rgba(217,119,6,0.15)',
      success: '#4ADE80', successLight: 'rgba(22,163,74,0.15)', info: '#60A5FA', infoLight: 'rgba(37,99,235,0.15)',
      onPrimary: '#FFFFFF', onError: '#FFFFFF',
      // ADR-V2: primary-derived roles come from the tint layer.
    },
  },
  // ADR-V2: no primary ramp — the tint layer owns it (default iOS blue).
  ramps: { accent: SLATE_ACCENT, neutral: ZINC },
  // Inter everywhere — no display serif, no rounded face. Mono is the
  // platform's native monospace stack (Geist idiom).
  typography: {
    sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
    display: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
    mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
  },
  // Tight, uniform corners — shadcn radius scale.
  radius: { input: '0.375rem', btn: '0.375rem', card: '0.5rem', dialog: '0.625rem' },
  shadow: {
    light: {
      '--shadow-xs': '0 1px 2px 0 rgba(0,0,0,0.05)',
      '--shadow-sm': '0 1px 3px 0 rgba(0,0,0,0.07), 0 1px 2px -1px rgba(0,0,0,0.05)',
      '--shadow-md': '0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05)',
      '--shadow-lg': '0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.05)',
      // ADR-V2: --shadow-focus inherits the platform tint-following value.
    },
    dark: {
      '--shadow-xs': '0 1px 2px 0 rgba(0,0,0,0.4)',
      '--shadow-sm': '0 1px 3px 0 rgba(0,0,0,0.45), 0 1px 2px -1px rgba(0,0,0,0.4)',
      '--shadow-md': '0 4px 6px -1px rgba(0,0,0,0.5), 0 2px 4px -2px rgba(0,0,0,0.4)',
      '--shadow-lg': '0 10px 15px -3px rgba(0,0,0,0.55), 0 4px 6px -4px rgba(0,0,0,0.45)',
    },
  },
  // Fast and sober — short durations, standard easing, NO overshoot spring.
  motion: {
    '--duration-fast': '100ms',
    '--duration-base': '150ms',
    '--duration-slow': '200ms',
    '--ease-smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
    '--ease-spring': 'cubic-bezier(0.4, 0, 0.2, 1)',
    '--ease-in': 'cubic-bezier(0.4, 0, 1, 1)',
  },
  // Restrained identity hues (chart-style, not status) — indigo, cyan-teal,
  // emerald, yellow, orange, rose, violet, fuchsia. -600s in light, -300/400s
  // in dark; none collides with the mode's status colors.
  categorical: {
    light: ['#4F46E5', '#0E7490', '#059669', '#CA8A04', '#EA580C', '#E11D48', '#7C3AED', '#C026D3'],
    dark: ['#818CF8', '#22D3EE', '#34D399', '#FDE047', '#FB923C', '#FB7185', '#A78BFA', '#E879F9'],
  },
};

export default minimal;
