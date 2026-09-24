import digitaTheme from "@digitaplatform/theme/preset";

/** The website renders with the app's design tokens: the central preset is the only design source. */
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  presets: [digitaTheme],
};
