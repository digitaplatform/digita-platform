// Vendor ESM for react/jsx-runtime — what @vitejs/plugin-react's automatic JSX
// runtime imports in BOTH host and plugins. Externalized + shared so host JSX and
// plugin JSX (and bundled lucide-react's jsx calls) use the one shared react.
export { Fragment, jsx, jsxs } from 'react/jsx-runtime';
