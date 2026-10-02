// @vitest-environment jsdom
// The browser tab names the tenant as the app's header does: its app_name, else the look's own
// name. index.html's fixed "Digita" stood in the tab of every tenant. The pages are stubs: App.tsx
// alone sets the tab.
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { getSignature } from '@digitaplatform/theme';

vi.mock('@/pages/ListPage', () => ({ default: () => <p>list page</p> }));
vi.mock('@/pages/AccountPage', () => ({ default: () => <p>account page</p> }));
vi.mock('@/pages/LoginPage', () => ({ default: () => <p>sign-in page</p> }));
vi.mock('@/pages/PluginPagePlaceholder', () => ({ default: () => <p>plugin page placeholder</p> }));
vi.mock('@/pages/DashboardPage', () => ({ default: () => <p>start page</p> }));
vi.mock('@/pages/RecordPage', () => ({ default: () => <p>record page</p> }));
vi.mock('@/pages/SetupPage', () => ({ default: () => <p>setup page</p> }));
vi.mock('@/pages/JobsPage', () => ({ default: () => <p>jobs page</p> }));
vi.mock('@/pages/GroupsPage', () => ({ default: () => <p>groups page</p> }));
vi.mock('@/pages/DesignPage', () => ({ default: () => <p>design page</p> }));

import type { BootData } from '@/types';
import { useSessionStore } from '@/stores/session';
import { useThemeStore } from '@/stores/theme';
import App from '@/App';

describe("the app's browser tab", () => {
  it('PLANTED DEFECT: names the tenant, and the look when the tenant set no name', async () => {
    const boot = { user: null, locale: { code: 'en' }, available_languages: [] } as unknown as BootData;
    useSessionStore.setState({ branding: { app_name: 'Velo Luck GmbH' }, bootstrap: async () => boot });
    render(<App />);
    expect(await screen.findByText('sign-in page')).toBeInTheDocument();
    expect(document.title).toBe('Velo Luck GmbH');

    act(() => {
      useSessionStore.setState({ branding: {} });
      useThemeStore.setState({ signature: 'simetrix' });
    });
    expect(getSignature('simetrix').name).not.toBe('Digita');
    expect(document.title).toBe(getSignature('simetrix').name);
  });
});
