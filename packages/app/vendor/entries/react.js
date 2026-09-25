// Vendor ESM shim for React. React 19 ships as CJS (no browser-ESM build), so we
// import the default and explicitly re-export the named surface that host + plugin
// code (and bundled deps like lucide-react) import by name. The default export is
// the complete React object (incl. internals react-dom reads via property access).
// Built once with NODE_ENV=production; this is THE single shared React instance.
import React from 'react';

export default React;

export const {
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  cloneElement,
  createContext,
  createElement,
  createRef,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  startTransition,
  use,
  useActionState,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version,
} = React;
