import type { Design } from '../types.js';
import { COLOR_PALETTES } from '../../tokens/palettes.js';

/**
 * IOS — Apple HIG token design: clean light greys, system blue, generous soft
 * radii, San Francisco system type. `meta.variant: 'ios'` pre-wires the deeper
 * component-variant layer (segmented controls, sheets, 44px targets) for Phase 6;
 * at the token level it already reads unmistakably iOS.
 */
const IOS_GRAY = {
  50: '#F2F2F7', 100: '#E5E5EA', 200: '#D1D1D6', 300: '#C7C7CC', 400: '#AEAEB2',
  500: '#8E8E93', 600: '#636366', 700: '#48484A', 800: '#3A3A3C', 900: '#1C1C1E', 950: '#000000',
};

const ios: Design = {
  meta: {
    id: 'ios',
    name: 'iOS',
    description: 'Apple HIG — clean greys, system blue, soft rounded.',
    variant: 'ios',
  },
  semantic: {
    light: {
      bg: '#F2F2F7', surface: '#FFFFFF', subtle: '#E5E5EA', border: '#D1D1D6', borderStrong: '#C7C7CC',
      bgHover: '#E9E9EE', surfaceGlass: 'rgba(255,255,255,0.72)',
      // Surface-container steps (P2.4) — HIG system-gray ramp white → gray-6/5.
      surfaceContainerLowest: '#FFFFFF', surfaceContainerLow: '#F7F7FC', surfaceContainer: '#EFEFF4',
      surfaceContainerHigh: '#EAEAF0', surfaceContainerHighest: '#E5E5EA',
      textMain: '#1C1C1E', textMuted: '#8E8E93',
      error: '#FF3B30', errorLight: '#FFF0EF', warning: '#FF9500', warningLight: '#FFF7ED',
      success: '#34C759', successLight: '#EEFBF1', info: '#007AFF', infoLight: '#EBF5FF',
      onPrimary: '#FFFFFF', onError: '#FFFFFF',
      // ADR-V2: primaryContainer/onPrimaryContainer/selection/selectionSoft
      // come from the tint layer (design is primary-less; the default tint IS
      // iOS blue, so this design's resting look is unchanged).
    },
    dark: {
      bg: '#000000', surface: '#1C1C1E', subtle: '#2C2C2E', border: '#38383A', borderStrong: '#48484A',
      bgHover: 'rgba(255,255,255,0.06)', surfaceGlass: 'rgba(28,28,30,0.72)',
      // Surface-container steps (P2.4) — elevated dark grays (bg is true black).
      surfaceContainerLowest: '#0A0A0B', surfaceContainerLow: '#161618', surfaceContainer: '#1C1C1E',
      surfaceContainerHigh: '#242426', surfaceContainerHighest: '#2C2C2E',
      textMain: '#FFFFFF', textMuted: '#98989F',
      error: '#FF453A', errorLight: 'rgba(255,69,58,0.14)', warning: '#FF9F0A', warningLight: 'rgba(255,159,10,0.14)',
      success: '#30D158', successLight: 'rgba(48,209,88,0.14)', info: '#0A84FF', infoLight: 'rgba(10,132,255,0.14)',
      onPrimary: '#FFFFFF', onError: '#FFFFFF',
      // ADR-V2: primary-derived roles come from the tint layer.
    },
  },
  // ADR-V2: no primary ramp — the tint layer owns it (default iOS blue).
  ramps: { accent: COLOR_PALETTES.indigo, neutral: IOS_GRAY },
  typography: {
    sans: ['-apple-system', 'system-ui', 'SF Pro Text', 'Inter', 'sans-serif'],
    display: ['-apple-system', 'system-ui', 'SF Pro Display', 'Inter', 'sans-serif'],
  },
  // Generous soft corners.
  radius: { input: '0.5rem', btn: '0.625rem', card: '0.875rem', dialog: '1.25rem' },
  shadow: {
    light: {
      '--shadow-xs': '0 1px 2px rgba(0,0,0,0.05)',
      '--shadow-sm': '0 2px 6px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.05)',
      '--shadow-md': '0 6px 16px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.06)',
      '--shadow-lg': '0 16px 36px rgba(0,0,0,0.14), 0 6px 12px rgba(0,0,0,0.08)',
      // ADR-V2: --shadow-focus inherits the platform tint-following value.
    },
    dark: {
      '--shadow-xs': '0 1px 2px rgba(0,0,0,0.6)',
      '--shadow-sm': '0 2px 6px rgba(0,0,0,0.6), 0 1px 2px rgba(0,0,0,0.5)',
      '--shadow-md': '0 6px 16px rgba(0,0,0,0.65), 0 2px 6px rgba(0,0,0,0.5)',
      '--shadow-lg': '0 16px 36px rgba(0,0,0,0.7), 0 6px 12px rgba(0,0,0,0.55)',
    },
  },
  // Smooth ease-out, gentle spring.
  motion: {
    '--duration-fast': '80ms',
    '--duration-base': '200ms',
    '--duration-slow': '320ms',
    '--ease-smooth': 'cubic-bezier(0.32, 0.72, 0, 1)',
    '--ease-spring': 'cubic-bezier(0.32, 0.72, 0, 1)',
    '--ease-in': 'cubic-bezier(0.4, 0, 1, 1)',
  },
  // Apple system palette (HIG) — blue, green, indigo, orange, pink, purple, teal, mint.
  categorical: {
    light: ['#007AFF', '#34C759', '#5856D6', '#FF9500', '#FF2D55', '#AF52DE', '#30B0C7', '#00C7BE'],
    dark: ['#0A84FF', '#30D158', '#5E5CE6', '#FF9F0A', '#FF375F', '#BF5AF2', '#40C8E0', '#66D4CF'],
  },
};

export default ios;
