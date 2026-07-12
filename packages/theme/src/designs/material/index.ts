import type { Design } from '../types.js';
import { COLOR_PALETTES } from '../../tokens/palettes.js';

/**
 * MATERIAL — Android Material 3 (Material You) token design: tonal purple
 * baseline, large "extra-large" radii (pill buttons), Roboto type, elevation
 * tiers. `meta.variant: 'material'` pre-wires the deeper component-variant layer
 * (ripple, FAB, elevation, emphasized easing) for Phase 6; at the token level it
 * already reads unmistakably M3.
 */
const M3_NEUTRAL = {
  50: '#FEF7FF', 100: '#F3EDF7', 200: '#E7E0EC', 300: '#CAC4D0', 400: '#AEA9B4',
  500: '#79747E', 600: '#605D66', 700: '#49454F', 800: '#322F37', 900: '#1D1B20', 950: '#141218',
};

const material: Design = {
  meta: {
    id: 'material',
    name: 'Material 3',
    description: 'Android Material You — tonal purple, pill buttons, Roboto.',
    variant: 'material',
  },
  semantic: {
    light: {
      bg: '#FEF7FF', surface: '#FFFFFF', subtle: '#F3EDF7', border: '#CAC4D0', borderStrong: '#79747E',
      bgHover: '#F0EBF4', surfaceGlass: 'rgba(255,255,255,0.7)',
      // M3 baseline surface-container tonal steps (neutral N100/N96/N94/N92/N90).
      surfaceContainerLowest: '#FFFFFF', surfaceContainerLow: '#F7F2FA', surfaceContainer: '#F3EDF7',
      surfaceContainerHigh: '#ECE6F0', surfaceContainerHighest: '#E6E0E9',
      textMain: '#1D1B20', textMuted: '#49454F',
      error: '#B3261E', errorLight: '#FCEEEE', warning: '#E8871E', warningLight: '#FEF6EC',
      success: '#146C2E', successLight: '#E9F6EC', info: '#6750A4', infoLight: '#EADDFF',
      onPrimary: '#FFFFFF', onError: '#FFFFFF',
      // ADR-V2: primaryContainer/onPrimaryContainer/selection/selectionSoft
      // come from the tint layer (design is primary-less; the 'violet' tint
      // reproduces the M3 baseline purple).
    },
    dark: {
      bg: '#141218', surface: '#1D1B20', subtle: '#2B2930', border: '#49454F', borderStrong: '#938F99',
      bgHover: 'rgba(255,255,255,0.06)', surfaceGlass: 'rgba(29,27,32,0.72)',
      // M3 baseline dark surface-container tonal steps (neutral N4/N10/N12/N17/N22).
      surfaceContainerLowest: '#0F0D13', surfaceContainerLow: '#1D1B20', surfaceContainer: '#211F26',
      surfaceContainerHigh: '#2B2930', surfaceContainerHighest: '#36343B',
      textMain: '#E6E1E9', textMuted: '#CAC4D0',
      error: '#F2B8B5', errorLight: 'rgba(179,38,30,0.2)', warning: '#FFB77C', warningLight: 'rgba(232,135,30,0.18)',
      success: '#7DD693', successLight: 'rgba(20,108,46,0.2)', info: '#D0BCFF', infoLight: 'rgba(103,80,164,0.24)',
      onPrimary: '#FFFFFF', onError: '#FFFFFF',
      // ADR-V2: primary-derived roles come from the tint layer.
    },
  },
  // ADR-V2: no primary ramp — the tint layer owns it (default iOS blue).
  ramps: { accent: COLOR_PALETTES.pink, neutral: M3_NEUTRAL },
  typography: {
    sans: ['Roboto', 'system-ui', 'Inter', 'sans-serif'],
    display: ['Roboto', 'system-ui', 'Inter', 'sans-serif'],
  },
  // M3 large/extra-large shapes — full-pill buttons.
  radius: { input: '0.25rem', btn: '9999px', card: '0.75rem', dialog: '1.75rem' },
  shadow: {
    light: {
      '--shadow-xs': '0 1px 2px rgba(0,0,0,0.10)',
      '--shadow-sm': '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)',
      '--shadow-md': '0 4px 8px rgba(0,0,0,0.14), 0 1px 3px rgba(0,0,0,0.10)',
      '--shadow-lg': '0 8px 16px rgba(0,0,0,0.16), 0 3px 6px rgba(0,0,0,0.12)',
      // ADR-V2: --shadow-focus inherits the platform tint-following value.
    },
    dark: {
      '--shadow-xs': '0 1px 2px rgba(0,0,0,0.55)',
      '--shadow-sm': '0 1px 3px rgba(0,0,0,0.6), 0 1px 2px rgba(0,0,0,0.5)',
      '--shadow-md': '0 4px 8px rgba(0,0,0,0.65), 0 1px 3px rgba(0,0,0,0.5)',
      '--shadow-lg': '0 8px 16px rgba(0,0,0,0.7), 0 3px 6px rgba(0,0,0,0.55)',
    },
  },
  // M3 emphasized easing.
  motion: {
    '--duration-fast': '100ms',
    '--duration-base': '200ms',
    '--duration-slow': '300ms',
    '--ease-smooth': 'cubic-bezier(0.2, 0, 0, 1)',
    '--ease-spring': 'cubic-bezier(0.2, 0, 0, 1)',
    '--ease-in': 'cubic-bezier(0.4, 0, 1, 1)',
  },
  // Material 3 tonal palette — purple, teal, blue, green, orange, magenta, indigo, mauve.
  categorical: {
    light: ['#6750A4', '#00696E', '#005AC1', '#386A20', '#8F4C00', '#9A25AE', '#3F51B5', '#7D5260'],
    dark: ['#D0BCFF', '#4FD8E4', '#ADC6FF', '#9DD67D', '#FFB77C', '#F7ADFF', '#BAC3FF', '#E9B9C6'],
  },
};

export default material;
