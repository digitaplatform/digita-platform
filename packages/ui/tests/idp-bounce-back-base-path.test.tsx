// @vitest-environment jsdom
// Under a base path the IdP's bounce-back target keeps it: a target built from the router's
// path alone (/sales-order) sends the user, once signed in, to the tenant's website instead of
// back into the app.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  (window as unknown as Record<string, unknown>).__APP_BASE_PATH__ = '/erp';
});

const redirectToIdpLogin = vi.fn();
vi.mock('@/lib/authConfig', () => ({
  AUTH_URL: 'https://acme.example/auth',
  AUTH_COOKIE_SUFFIX: '',
  authUrl: (path: string) => `https://acme.example/auth${path}`,
  redirectToIdpLogin: (...args: unknown[]) => redirectToIdpLogin(...args),
}));
vi.mock('@/services/auth', () => ({ logout: () => Promise.resolve() }));

import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import LoginPage from '@/pages/LoginPage';
import { useSessionStore } from '@/stores/session';

function renderLogin(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state }]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('the IdP bounce-back target under the base path /erp', () => {
  beforeEach(() => redirectToIdpLogin.mockClear());

  it('carries the base path in front of the route the user wanted', () => {
    renderLogin({ from: { pathname: '/sales-order', search: '?view=open' } });
    expect(redirectToIdpLogin).toHaveBeenCalledWith(`${window.location.origin}/erp/sales-order?view=open`);
  });

  it('is the app home when no route was remembered', () => {
    renderLogin();
    expect(redirectToIdpLogin).toHaveBeenCalledWith(`${window.location.origin}/erp/`);
  });

  it('is the app home after a sign-out, not the root of the host', async () => {
    await useSessionStore.getState().logout();
    expect(redirectToIdpLogin).toHaveBeenCalledWith(`${window.location.origin}/erp/`);
  });
});
