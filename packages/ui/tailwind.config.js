import digitaTheme from '@digitaplatform/theme/preset';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    // Central component kit: its primitives render with these Tailwind classes but
    // are built separately, so the HOST must scan their SOURCE or the classes get
    // purged from the served CSS (build-time CSS only — no runtime coupling).
    '../components/src/**/*.{js,ts,jsx,tsx}',
    // Central plugin library — same reason; scope to src/ so we never walk node_modules.
    '../plugins/plugins/*/src/**/*.{js,ts,jsx,tsx}',
  ],
  // The design tokens (colors, fonts, shadows, darkMode:'class') come from the
  // central @digitaplatform/theme preset — one source for every Digita frontend + plugin.
  presets: [digitaTheme],
  theme: {
    // App-specific extensions only (none yet); design tokens live in the preset.
    extend: {},
  },
  plugins: [],
};
