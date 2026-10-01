// @vitest-environment jsdom
// A wrong current password is the IdP's answer to the form, not an expired session: the page
// shows it at the current-password field and stays where it is. Every other 401 still refreshes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { sessionCookieNames } from '@digitaplatform/shared';
import { DialogHostProvider } from '@/components/overlay/DialogHost';
import { useSessionStore } from '@/stores/session';
import { api } from '@/services/api';
import { AUTH_COOKIE_SUFFIX } from '@/lib/authConfig';
import type { SessionUser } from '@/types';
import AccountPage from '@/pages/AccountPage';

const redirectToIdpLogin = vi.fn();
vi.mock('@/lib/authConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/authConfig')>()),
  redirectToIdpLogin: (...args: unknown[]) => redirectToIdpLogin(...args),
}));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** The answers by method and path; every call is recorded. */
let answers: Record<string, () => Response> = {};
let calls: string[] = [];

beforeEach(() => {
  // A readable CSRF cookie: a live session, so a 401 elsewhere would try a refresh.
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    writable: true,
    value: `${sessionCookieNames(AUTH_COOKIE_SUFFIX).CSRF}=csrf-123`,
  });
  redirectToIdpLogin.mockClear();
  calls = [];
  answers = {
    'GET /api/v1/auth/sessions': () => json([]),
    'POST /api/v1/auth/refresh': () => json({ ok: true }),
  };
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${init?.method ?? 'GET'} ${new URL(String(url), window.location.origin).pathname}`;
    calls.push(route);
    const answer = answers[route];
    if (!answer) throw new Error(`unexpected fetch: ${route}`);
    return answer();
  });
  useSessionStore.setState({ user: { _id: 'u1', email: 'ada@example.com', roles: [] } as SessionUser, languages: [] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useSessionStore.setState({ user: null });
});

function renderAccount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <DialogHostProvider>
        <AccountPage />
      </DialogHostProvider>
    </QueryClientProvider>,
  );
}

describe('a password change with a wrong current password', () => {
  it('shows the error at the current-password field, with no refresh and no navigation', async () => {
    answers['POST /api/v1/auth/password'] = () => json({ error: 'invalid_current_password' }, 401);
    renderAccount();
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'wrong' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'next-secret' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'next-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true');
    expect(calls).not.toContain('POST /api/v1/auth/refresh');
    expect(calls.filter((c) => c === 'POST /api/v1/auth/password')).toHaveLength(1);
    expect(redirectToIdpLogin).not.toHaveBeenCalled();
  });

  it('still refreshes an expired session on the password route', async () => {
    let first = true;
    answers['POST /api/v1/auth/password'] = () => {
      const answer = first ? json({ error: 'unauthorized' }, 401) : json({ ok: true });
      first = false;
      return answer;
    };
    await expect(
      api.post(`${new URL('/api/v1/auth/password', window.location.origin)}`, {
        current_password: 'a',
        new_password: 'b',
      }),
    ).resolves.toEqual({ ok: true });
    expect(calls).toEqual(['POST /api/v1/auth/password', 'POST /api/v1/auth/refresh', 'POST /api/v1/auth/password']);
  });

  it('still refreshes and retries a 401 from an ordinary engine call', async () => {
    let first = true;
    answers['GET /api/v1/resource/Customer'] = () => {
      const answer = first ? json({ error: 'unauthorized' }, 401) : json({ success: true, messages: [], data: [] });
      first = false;
      return answer;
    };
    await api.get('/api/v1/resource/Customer');
    expect(calls).toEqual(['GET /api/v1/resource/Customer', 'POST /api/v1/auth/refresh', 'GET /api/v1/resource/Customer']);
    expect(redirectToIdpLogin).not.toHaveBeenCalled();
  });
});
