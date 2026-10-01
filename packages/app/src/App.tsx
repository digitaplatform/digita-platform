import { useEffect, useState } from 'react';
import { createBrowserRouter, RouterProvider, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSessionStore, pickBootLocale } from '@/stores/session';
import { useI18nStore } from '@/stores/i18n';
import { useChrome } from '@/lib/chrome-i18n';
import { Spinner } from '@digitaplatform/components';
import { AudienceShell } from '@/templates/AudienceShell';
import { registerBuiltinTemplates } from '@/templates/template-registry';
import { installHostServices } from '@/plugins/host-services';
import { loadAppComposition } from '@/plugins/composition';
import { APP_BASE_PATH } from '@/lib/appBase';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import RecordPage from '@/pages/RecordPage';
import ListPage from '@/pages/ListPage';
import AccountPage from '@/pages/AccountPage';
import JobsPage from '@/pages/JobsPage';
import GroupsPage from '@/pages/GroupsPage';
import DesignPage from '@/pages/DesignPage';
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
          className="rounded bg-primary-600 px-4 py-2 text-sm font-medium text-onPrimary hover:bg-primaryHover"
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
// The app's own lowercase paths match case-sensitively: React Router ignores case otherwise, and
// /Account, /App and /Login would never reach the list of an entity named Account, App or Login.
const router = createBrowserRouter([
  { path: '/login', caseSensitive: true, element: <LoginPage /> },
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
          { path: 'app/*', caseSensitive: true, element: <PluginPagePlaceholder /> },
          // Self-service account (static → ranked ahead of :entity).
          { path: 'account', caseSensitive: true, element: <AccountPage /> },
      // Jobs satellite panel (menu entry gates on /health + role; deep links
      // simply show the no-access block when the tenant has no opt-in).
      { path: '_jobs', element: <JobsPage /> },
          // Master-data Groups — dedicated tree-management module (static → ranked
          // ahead of the generic :entity catch-alls). Menu-gated for rights.
          { path: '_groups', element: <GroupsPage /> },
          // Design showcase: every design on every kit component, administrators only. The underscore
          // keeps the path off the namespace an app entity may take, as _jobs and _groups do.
          { path: '_design', element: <DesignPage /> },
          // Generic meta-driven renderer. `new` is static → ranked ahead of :name.
          { path: ':entity/new', element: <RecordPage />, errorElement: <PageError /> },
          { path: ':entity/:name', element: <RecordPage />, errorElement: <PageError /> },
          { path: ':entity', element: <ListPage />, errorElement: <PageError /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
], { basename: APP_BASE_PATH || '/' });

export default function App() {
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
        const { resolved, data } = await pickBootLocale();
        if (data?.user) {
          // Authenticated on load: backend (data) translations are auth-gated, so
          // load them here (the login screen needs only static chrome strings).
          // Then the app's plugin composition + layout. A sign-in comes back from
          // the IdP as a full page load, so this boot is the only place that runs
          // both. Fail loud on an unknown template id (→ the error screen).
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
  }, [loadI18n]);

  if (!ready) return <Splash />;
  if (bootError) return <BootError error={bootError} />;

  return <RouterProvider router={router} />;
}
