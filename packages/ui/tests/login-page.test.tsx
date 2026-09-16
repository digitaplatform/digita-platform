// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import LoginPage from '@/pages/LoginPage';

/**
 * /login has no form any more — it hands the browser to the tenant IdP and
 * carries the route the user actually wanted as the bounce-back target.
 */

const redirectToIdpLogin = vi.fn();
vi.mock('@/lib/authConfig', () => ({
  AUTH_URL: 'https://auth.acme.example',
  AUTH_COOKIE_SUFFIX: '',
  authUrl: (path: string) => `https://auth.acme.example${path}`,
  redirectToIdpLogin: (...args: unknown[]) => redirectToIdpLogin(...args),
}));

function renderLogin(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state }]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => redirectToIdpLogin.mockClear());

  it('redirects to the IdP with the route the user wanted', () => {
    renderLogin({ from: { pathname: '/sales-order', search: '?view=open' } });
    expect(redirectToIdpLogin).toHaveBeenCalledWith(
      `${window.location.origin}/sales-order?view=open`,
    );
  });

  it('redirects to the app home when no route was remembered — never back to /login', () => {
    renderLogin();
    expect(redirectToIdpLogin).toHaveBeenCalledWith(`${window.location.origin}/`);
  });

  it('shows that it is handing over instead of a sign-in form', () => {
    renderLogin();
    expect(screen.getByTestId('login-redirecting')).toBeInTheDocument();
    expect(screen.queryByTestId('login-password')).toBeNull();
  });
});
