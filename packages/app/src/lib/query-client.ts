import { QueryClient } from '@tanstack/react-query';

/**
 * Single app-wide query client. Server state (meta, lists, docs, translations,
 * boot) lives here; client UI state lives in Zustand stores. Defaults are
 * conservative for the dev phase — no surprise refetches, errors surface
 * loudly rather than silently retrying (see the no-silent-fallback rule).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});
