import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { queryClient } from '@/lib/query-client';
import { ErrorBoundary } from '@digitaplatform/components';
import { DialogHostProvider } from '@/components/overlay/DialogHost';
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';
// Vendored from country-flag-emoji-polyfill (its exports map hides the file).
// Glyphs: Twemoji, CC-BY 4.0 (c) Twitter — flags only, 76KB.
import flagFontUrl from './assets/TwemojiCountryFlags.woff2?url';
import './index.css';
// Side-effect import: registers the BUILT-IN first-party plugins (usermenu, …)
// with the plugin registry at module load — before the shell renders, so the
// layout's regions resolve without any runtime plugin fetch. See builtins.ts.
import '@/plugins/builtins';

// Windows Chrome renders no flag emoji (Segoe UI Emoji ships none) — the
// Language switcher's flag_emoji seeds showed as bare letters. This registers
// a flags-only woff2 (bundled, so CSP 'self' holds) and no-ops on platforms
// that already render flags; the theme's sans stack lists the family first.
polyfillCountryFlagEmojis('Twemoji Country Flags', flagFontUrl);

// Shared-singleton self-test. Host + runtime-loaded plugins MUST share one React
// (resolved via the import-map). A second React instance is the classic prod-only
// "invalid hook call"; record ours and warn loudly if a different one appears.
declare global {
  interface Window {
    __DIGITA_REACT__?: typeof React;
  }
}
if (window.__DIGITA_REACT__ && window.__DIGITA_REACT__ !== React) {
  console.error(
    '[digita] FATAL: multiple React instances detected — the import-map / vendor build is misconfigured. Plugins will fail with "invalid hook call".',
  );
}
window.__DIGITA_REACT__ = React;

function FatalScreen({ error }: { error: Error }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        fontFamily: 'Inter, system-ui, sans-serif',
        background: '#f8fafc',
        color: '#0f172a',
      }}
    >
      <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#dc2626' }}>Application error</h1>
        <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#475569', wordBreak: 'break-word' }}>
          {error.message}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: '1rem',
            borderRadius: '0.375rem',
            background: '#2563eb',
            color: '#fff',
            padding: '0.5rem 1rem',
            fontSize: '0.875rem',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={(error) => <FatalScreen error={error} />}>
      <QueryClientProvider client={queryClient}>
        <DialogHostProvider>
          <App />
        </DialogHostProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
