// SINGLE SOURCE OF TRUTH for the plugin-ESM shared-singleton contract.
//
// Three things must agree or runtime plugin federation breaks (host + plugins
// would get separate React/ReactDOM/router/host-services instances):
//   1. vite.config.ts          — rollupOptions.external + optimizeDeps.exclude
//   2. vendor/build-vendor.mjs — the vendor ESM entries + the import-map keys
//   3. the inline import-map    — generated from (2)
// Previously these were duplicated by hand (a drift here caused the deployed
// "react-dom does not provide createPortal" crash). They now derive from here,
// and tests/vendor-externals.test.ts asserts they stay consistent.

/** Bare specifiers the host leaves un-bundled (resolved by the import-map). */
export const SHARED_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
  'react-router',
  'react-router/dom',
  'react-router-dom',
  '@digitaplatform/plugins',
];

/** Vendor entry name → its source file under vendor/entries/. */
export const ENTRY_FILES = {
  react: 'react.js',
  'react-jsx-runtime': 'react-jsx-runtime.js',
  'react-jsx-dev-runtime': 'react-jsx-dev-runtime.js',
  'react-dom': 'react-dom.js',
  'react-dom-client': 'react-dom-client.js',
  'react-router': 'react-router.js',
  'digita-plugins': 'digita-plugins.js',
};

/** import-map specifier → vendor entry name (several specifiers may share one). */
export const SPECIFIER_TO_ENTRY = {
  react: 'react',
  'react/jsx-runtime': 'react-jsx-runtime',
  'react/jsx-dev-runtime': 'react-jsx-dev-runtime',
  'react-dom': 'react-dom',
  'react-dom/client': 'react-dom-client',
  'react-router': 'react-router',
  'react-router-dom': 'react-router',
  'react-router/dom': 'react-router',
  '@digitaplatform/plugins': 'digita-plugins',
};
