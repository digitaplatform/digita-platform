import digitaTheme from "@digitaplatform/theme/preset";

/** The website renders with the app's design tokens and components: the central preset is the only
 *  design source. */
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{ts,tsx}",
    // The component kit renders with these Tailwind classes but is built separately, so the site
    // scans its SOURCE, as the app does, or the classes are purged from the served CSS.
    "../components/src/**/*.{js,ts,jsx,tsx}",
  ],
  presets: [digitaTheme],
};
