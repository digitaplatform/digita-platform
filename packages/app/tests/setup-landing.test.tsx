// @vitest-environment jsdom
// A workshop's Administrator signs in and arrives at the app's start page while the settings record
// still lacks values. The app opens the setup page instead, once: a link into the app keeps its
// target, and a user who can fill nothing gets the start page with the notice. The pages are
// stubs: the boot of App.tsx alone decides which one opens. The app is served under a base path,
// as on a tenant's host, where the browser's path of the start page is not "/".
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.hoisted(() => {
  (window as unknown as Record<string, unknown>).__APP_BASE_PATH__ = '/workshop';
});

vi.mock('@/pages/ListPage', async () => {
  const { useParams } = await import('react-router-dom');
  return { default: () => <p>{`list of ${useParams().entity}`}</p> };
});
vi.mock('@/pages/AccountPage', () => ({ default: () => <p>account page</p> }));
vi.mock('@/pages/LoginPage', () => ({ default: () => <p>sign-in page</p> }));
vi.mock('@/pages/PluginPagePlaceholder', () => ({ default: () => <p>plugin page placeholder</p> }));
vi.mock('@/pages/DashboardPage', () => ({ default: () => <p>start page</p> }));
vi.mock('@/pages/RecordPage', () => ({ default: () => <p>record page</p> }));
vi.mock('@/pages/SetupPage', () => ({ default: () => <p>setup page</p> }));
vi.mock('@/pages/JobsPage', () => ({ default: () => <p>jobs page</p> }));
vi.mock('@/pages/GroupsPage', () => ({ default: () => <p>groups page</p> }));
vi.mock('@/pages/DesignPage', () => ({ default: () => <p>design page</p> }));
vi.mock('@/templates/AudienceShell', async () => {
  const { Outlet } = await import('react-router-dom');
  return { AudienceShell: () => <Outlet /> };
});
vi.mock('@/plugins/composition', () => ({ loadAppComposition: async () => {} }));

import type { BootData, BootSetup } from '@/types';
import { useSessionStore } from '@/stores/session';
import { useI18nStore } from '@/stores/i18n';
import App from '@/App';

const PENDING = { entity: 'WorkshopSetting', fields: ['street'], missing_record: false };

/** Sign in with a boot answer that carries `setup`, and enter the app at `path` of the browser. */
function enterAt(path: string, setup: BootSetup | null) {
  const boot = {
    user: { _id: 'a', email: 'admin@digita.local', full_name: 'Admin', roles: ['Administrator'] },
    locale: { code: 'en' },
    available_languages: [],
    system_settings: { platform_name: 'p', default_currency: null, allow_user_language: true, timezone: 'UTC' },
    setup,
  } as unknown as BootData;
  useSessionStore.setState({ status: 'authenticated', bootstrap: async () => boot });
  useI18nStore.setState({ load: async () => {} });
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  render(<App />);
}

describe('entering an app that is not set up', () => {
  it('opens the setup page at the start page, for a user who can complete the setup', async () => {
    enterAt('/workshop/', { complete: false, records: [PENDING] });
    expect(await screen.findByText('setup page')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/workshop/_setup');
  });

  it('keeps a link into the app on its target', async () => {
    enterAt('/workshop/Order', { complete: false, records: [PENDING] });
    expect(await screen.findByText('list of Order')).toBeInTheDocument();
  });

  it('opens the start page for a user who can fill nothing', async () => {
    enterAt('/workshop/', { complete: false, records: [] });
    expect(await screen.findByText('start page')).toBeInTheDocument();
  });
});

describe('entering an app that is set up', () => {
  it.each([
    ['complete', { complete: true, records: [] }],
    ['not told by an older engine', null],
  ])('opens the start page where the setup is %s', async (_case, setup) => {
    enterAt('/workshop/', setup);
    expect(await screen.findByText('start page')).toBeInTheDocument();
  });
});
