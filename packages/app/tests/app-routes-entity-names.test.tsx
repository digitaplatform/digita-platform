// @vitest-environment jsdom
// An app may name an entity Account, App or Login. Its list opens at /Account, /App and /Login,
// while the app's own pages keep their lowercase paths. The pages are stubs: the route table of
// App.tsx alone decides which one opens.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/pages/ListPage', async () => {
  const { useParams } = await import('react-router-dom');
  return { default: () => <p>{`list of ${useParams().entity}`}</p> };
});
vi.mock('@/pages/AccountPage', () => ({ default: () => <p>account page</p> }));
vi.mock('@/pages/LoginPage', () => ({ default: () => <p>sign-in page</p> }));
vi.mock('@/pages/PluginPagePlaceholder', () => ({ default: () => <p>plugin page placeholder</p> }));
vi.mock('@/pages/DashboardPage', () => ({ default: () => <p>dashboard</p> }));
vi.mock('@/pages/RecordPage', () => ({ default: () => <p>record page</p> }));
vi.mock('@/pages/JobsPage', () => ({ default: () => <p>jobs page</p> }));
vi.mock('@/pages/GroupsPage', () => ({ default: () => <p>groups page</p> }));
vi.mock('@/pages/DesignPage', () => ({ default: () => <p>design page</p> }));
vi.mock('@/templates/AudienceShell', async () => {
  const { Outlet } = await import('react-router-dom');
  return { AudienceShell: () => <Outlet /> };
});

import { useSessionStore } from '@/stores/session';
import App from '@/App';

beforeAll(() => {
  // A signed-in session whose boot answers nothing: no plugin or text load runs before the routes.
  useSessionStore.setState({ status: 'authenticated', bootstrap: async () => null });
});

/** Open `path` the way the browser's back button does: the router follows the popstate. */
function openAt(path: string) {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  render(<App />);
}

describe('the routes of an app with entities named like its own pages', () => {
  it.each(['Account', 'App', 'Login'])('opens the list of the entity %s', async (entity) => {
    openAt(`/${entity}`);
    expect(await screen.findByText(`list of ${entity}`)).toBeInTheDocument();
  });

  it.each([
    ['/account', 'account page'],
    ['/login', 'sign-in page'],
    ['/app/view/orders', 'plugin page placeholder'],
  ])('keeps %s on the page of the app', async (path, page) => {
    openAt(path);
    expect(await screen.findByText(page)).toBeInTheDocument();
  });
});
