// Vendor ESM for react-dom. Bundled (not external) together with react via the
// multi-entry + code-splitting build, so react-dom's internal require("react")
// resolves to the SHARED react chunk — no throwing dynamic-require shim. Shared
// so the host renderer + react-router-dom's flushSync use ONE react-dom instance.
//
// react-dom is CJS — `export * from 'react-dom'` does NOT reliably surface its
// named exports through esbuild's CJS→ESM interop (createPortal/flushSync went
// missing → "does not provide an export named 'createPortal'"). Mirror react.js:
// destructure the named surface explicitly off the default object.
import ReactDOM from 'react-dom';

export default ReactDOM;

export const {
  createPortal,
  flushSync,
  unstable_batchedUpdates,
  preconnect,
  prefetchDNS,
  preinit,
  preinitModule,
  preload,
  preloadModule,
  requestFormReset,
  version,
} = ReactDOM;
