import { useEffect, useState } from 'react';
import { createBrowserRouter, RouterProvider, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSessionStore, getStoredLocale, getBrowserLocale } from '@/stores/session';
import { useI18nStore } from '@/stores/i18n';
import { useChrome } from '@/lib/chrome-i18n';
import { Spinner } from '@digitaplatform/components';
import { AudienceShell } from '@/templates/AudienceShell';
import { registerBuiltinTemplates } from '@/templates/template-registry';
import { installHostServices } from '@/plugins/host-services';
import { loadAppComposition } from '@/plugins/composition';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import RecordPage from '@/pages/RecordPage';
import ListPage from '@/pages/ListPage';
import AccountPage from '@/pages/AccountPage';
import JobsPage from '@/pages/JobsPage';
import GroupsPage from '@/pages/GroupsPage';
import PluginPagePlaceholder from '@/pages/PluginPagePlaceholder';
import { PageError } from '@/components/render/PageError';

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Spinner className="h-8 w-8 text-primary-600" />
    </div>
  );
}

/** Fail-loud boot failure (e.g. an unknown template id) — never an endless splash. */
function BootError({ error }: { error: Error }) {
  const tc = useChrome();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-3 rounded-lg border border-border bg-surface p-6 text-center shadow-soft">
        <h1 className="text-lg font-semibold text-error">{tc('ui.error.startupFailed')}</h1>
        <p className="break-words text-sm text-textMuted">{error.message}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
        >
          {tc('ui.action.reload')}
        </button>
      </div>
    </div>
  );
}

/** Gate authenticated routes — bounce anonymous users to /login. */
function RequireAuth() {
  const status = useSessionStore((s) => s.status);
  const location = useLocation();
  if (status !== 'authenticated') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <Outlet />;
}

// createBrowserRouter (data router) — enables useBlocker (dirty-guard) + per-route
// errorElement. Built once; RouterProvider is only rendered after boot completes.
const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        // Audience seam (ADR-A1…A3): selects the shell for the active audience.
        // Internal-only today → renders ShellRenderer unchanged.
        element: <AudienceShell />,
        children: [
          { index: true, element: <DashboardPage /> },
          // `url`-kind menu targets (e.g. /app/view/...) until a plugin owns them.
          { path: 'app/*', element: <PluginPagePlaceholder /> },
          // Self-service account (static → ranked ahead of :entity).
          { path: 'account', element: <AccountPage /> },
      // Jobs satellite panel (menu entry gates on /health + role; deep links
      // simply show the no-access block when the tenant has no opt-in).
      { path: '_jobs', element: <JobsPage /> },
          // Master-data Groups — dedicated tree-management module (static → ranked
          // ahead of the generic :entity catch-alls). Menu-gated for rights.
          { path: '_groups', element: <GroupsPage /> },
          // Generic meta-driven renderer. `new` is static → ranked ahead of :name.
          { path: ':entity/new', element: <RecordPage />, errorElement: <PageError /> },
          { path: ':entity/:name', element: <RecordPage />, errorElement: <PageError /> },
          { path: ':entity', element: <ListPage />, errorElement: <PageError /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export default function App() {
  const bootstrap = useSessionStore((s) => s.bootstrap);
  const loadI18n = useI18nStore((s) => s.load);
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<Error | null>(null);

  // Boot: expose host services to plugins, resolve the session + translations,
  // then (when authenticated) load the app's plugins from the manifest and apply
  // the placement config — all before the first render. A failure surfaces as a
  // visible error screen (fail loud); `ready` is always set so we never hang on
  // the splash.
  useEffect(() => {
    void (async () => {
      try {
        installHostServices();
        registerBuiltinTemplates(); // static config — register before anything resolves a template
        // Decide the language BEFORE boot so the engine's locale resolver picks it
        // up via Accept-Language: a manually-stored choice wins; otherwise the
        // browser's language is the auto-detect default (the engine negotiates it
        // against the enabled languages, falling back to the platform default).
        const stored = getStoredLocale();
        const initial = stored ?? getBrowserLocale() ?? undefined;
        if (initial) document.documentElement.lang = initial;
        const data = await bootstrap();
        // The engine-resolved language (stored → browser → default). A stored
        // manual choice still wins over the engine's negotiation.
        const resolved = stored ?? data?.locale?.code ?? initial ?? 'en';
        if (data?.user) {
          // Authenticated on load: backend (data) translations are auth-gated, so
          // load them here (the login screen needs only static chrome strings).
          // Then the app's plugin composition + layout. Shared with
          // session.reloadAuthenticatedLayout, which re-runs both after an in-app
          // login. Fail loud on an unknown template id (→ the error screen).
          await loadI18n(resolved);
          // Active audience is `internal` today (the only wired SPA runtime).
          await loadAppComposition('internal', data.branding?.default_template);
        } else {
          // Anonymous (login screen): chrome strings are bundled, so localize them
          // to the resolved language without the auth-gated /translations fetch
          // (no 401 before sign-in). data translations load after login.
          document.documentElement.lang = resolved;
          useI18nStore.setState({ locale: resolved });
        }
      } catch (err) {
        setBootError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setReady(true);
      }
    })();
  }, [bootstrap, loadI18n]);

  if (!ready) return <Splash />;
  if (bootError) return <BootError error={bootError} />;

  return <RouterProvider router={router} />;
}
