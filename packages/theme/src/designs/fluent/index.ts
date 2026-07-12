import type { Design } from '../types.js';

/**
 * FLUENT — Microsoft Fluent 2 / Windows 11 token design: cool Segoe grays,
 * communication-blue accent, crisp 4px corners, layered key+ambient depth,
 * fast decelerate motion. `meta.variant: 'fluent'` pre-wires the deeper
 * component-variant layer (mica/acrylic surfaces, reveal focus, subtle
 * press states); at the token level it already reads unmistakably Windows.
 */
// Fluent gray ramp (gray10 → gray200) folded to the platform 11 steps.
const FLUENT_GRAY = {
  50: '#FAF9F8', 100: '#F3F2F1', 200: '#EDEBE9', 300: '#E1DFDD', 400: '#C8C6C4',
  500: '#A19F9D', 600: '#605E5C', 700: '#484644', 800: '#323130', 900: '#201F1E', 950: '#1B1A19',
};

// Fluent 2 brand ramp folded to 11 steps — communication blue, #0F6CBD at 600
// (brand80); light steps are the brand tints, dark steps the shades.
const FLUENT_BLUE = {
  50: '#EBF3FC', 100: '#CFE4FA', 200: '#B4D6FA', 300: '#96C6FA', 400: '#479EF5',
  500: '#2886DE', 600: '#0F6CBD', 700: '#115EA3', 800: '#0F548C', 900: '#0C3B5E', 950: '#082338',
};

const fluent: Design = {
  meta: {
    id: 'fluent',
    name: 'Fluent',
    description: 'Microsoft Fluent 2 — Segoe grays, communication blue, crisp corners, layered depth.',
    variant: 'fluent',
  },
  semantic: {
    light: {
      bg: '#FAF9F8', surface: '#FFFFFF', subtle: '#F3F2F1', border: '#E1DFDD', borderStrong: '#C8C6C4',
      bgHover: '#EDEBE9', surfaceGlass: 'rgba(255,255,255,0.78)',
      // Surface-container steps (P2.4) — Fluent gray ramp white → gray30.
      surfaceContainerLowest: '#FFFFFF', surfaceContainerLow: '#F8F7F6', surfaceContainer: '#F3F2F1',
      surfaceContainerHigh: '#EDEBE9', surfaceContainerHighest: '#E8E6E4',
      textMain: '#201F1E', textMuted: '#605E5C',
      error: '#C50F1F', errorLight: '#FDF3F4', warning: '#BC4B09', warningLight: '#FFF9F5',
      success: '#107C10', successLight: '#F1FAF1', info: '#0F6CBD', infoLight: '#EBF3FC',
      onPrimary: '#FFFFFF', onError: '#FFFFFF',
      // ADR-V2: primaryContainer/onPrimaryContainer/selection/selectionSoft
      // come from the tint layer (design is primary-less).
    },
    dark: {
      bg: '#1B1A19', surface: '#252423', subtle: '#292827', border: '#3B3A39', borderStrong: '#484644',
      bgHover: 'rgba(255,255,255,0.05)', surfaceGlass: 'rgba(37,36,35,0.78)',
      // Surface-container steps (P2.4) — elevated Windows dark layers.
      surfaceContainerLowest: '#141312', surfaceContainerLow: '#1F1E1D', surfaceContainer: '#252423',
      surfaceContainerHigh: '#2D2C2B', surfaceContainerHighest: '#343332',
      textMain: '#F3F2F1', textMuted: '#C8C6C4',
      error: '#F1707B', errorLight: 'rgba(197,15,31,0.16)', warning: '#FAA06B', warningLight: 'rgba(247,99,12,0.16)',
      success: '#54B054', successLight: 'rgba(16,124,16,0.16)', info: '#479EF5', infoLight: 'rgba(15,108,189,0.16)',
      onPrimary: '#FFFFFF', onError: '#FFFFFF',
      // ADR-V2: primary-derived roles come from the tint layer.
    },
  },
  // ADR-V2: no primary ramp — the tint layer owns it (default iOS blue).
  ramps: { accent: FLUENT_BLUE, neutral: FLUENT_GRAY },
  // Segoe UI everywhere — Windows system voice for body and headings alike.
  typography: {
    sans: ['Segoe UI', 'system-ui', '-apple-system', 'Inter', 'sans-serif'],
    display: ['Segoe UI', 'system-ui', '-apple-system', 'Inter', 'sans-serif'],
  },
  // Crisp Windows 11 corners — 4px controls, 8px surfaces.
  radius: { input: '0.25rem', btn: '0.25rem', card: '0.5rem', dialog: '0.5rem' },
  shadow: {
    light: {
      // Fluent depth: a soft key shadow paired with a tight ambient halo.
      '--shadow-xs': '0 1px 2px rgba(0,0,0,0.12), 0 0 2px rgba(0,0,0,0.10)',
      '--shadow-sm': '0 2px 4px rgba(0,0,0,0.14), 0 0 2px rgba(0,0,0,0.12)',
      '--shadow-md': '0 8px 16px rgba(0,0,0,0.14), 0 0 2px rgba(0,0,0,0.12)',
      '--shadow-lg': '0 32px 64px rgba(0,0,0,0.24), 0 0 8px rgba(0,0,0,0.20)',
      // ADR-V2: --shadow-focus inherits the platform tint-following value.
    },
    dark: {
      '--shadow-xs': '0 1px 2px rgba(0,0,0,0.5), 0 0 2px rgba(0,0,0,0.4)',
      '--shadow-sm': '0 2px 4px rgba(0,0,0,0.55), 0 0 2px rgba(0,0,0,0.45)',
      '--shadow-md': '0 8px 16px rgba(0,0,0,0.6), 0 0 2px rgba(0,0,0,0.5)',
      '--shadow-lg': '0 32px 64px rgba(0,0,0,0.7), 0 0 8px rgba(0,0,0,0.55)',
    },
  },
  // Fluent decelerate — quick, confident, no bounce.
  motion: {
    '--duration-fast': '100ms',
    '--duration-base': '200ms',
    '--duration-slow': '300ms',
    '--ease-smooth': 'cubic-bezier(0.33, 0, 0.1, 1)',
    '--ease-spring': 'cubic-bezier(0.33, 0, 0.1, 1)',
    '--ease-in': 'cubic-bezier(0.4, 0, 1, 1)',
  },
  // Fluent shared palette — blue, teal, green, gold, orange, berry, purple, magenta.
  categorical: {
    light: ['#0F6CBD', '#038387', '#107C10', '#986F0B', '#CA5010', '#C239B3', '#8764B8', '#E3008C'],
    dark: ['#479EF5', '#4AC0C6', '#6CCB5F', '#EAA300', '#FAA06B', '#D766C2', '#A98FD1', '#EE5FB8'],
  },
};

export default fluent;
