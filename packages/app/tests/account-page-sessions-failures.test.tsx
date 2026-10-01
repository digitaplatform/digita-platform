// @vitest-environment jsdom
// The sessions of the account page. A list the IdP does not answer is an error with a reload,
// never "No active sessions."; a revoke that fails says so.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DialogHostProvider } from '@/components/overlay/DialogHost';
import { useSessionStore } from '@/stores/session';
import type { SessionUser } from '@/types';
import type { SessionSummary } from '@/services/account';
import AccountPage from '@/pages/AccountPage';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const session = (sessionId: string, user_agent: string): SessionSummary => ({ sessionId, status: 'Active', user_agent });

/** The answers of the IdP's self-service routes, by method and path; a test plants a failure. */
let answers: Record<string, () => Response> = {};

beforeEach(() => {
  answers = {
    'GET /api/v1/auth/sessions': () => json([session('s1', 'Firefox on Linux'), session('s2', 'Safari on iPhone')]),
  };
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${init?.method ?? 'GET'} ${new URL(String(url), window.location.origin).pathname}`;
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

/** Confirm the question the page asks before it signs a session out. */
async function confirmWith(label: string) {
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: label }));
}

describe('the sessions of the account page', () => {
  it('lists the sessions the IdP answers', async () => {
    renderAccount();
    expect(await screen.findByText('Safari on iPhone')).toBeInTheDocument();
    expect(screen.queryByText('Failed to load sessions')).toBeNull();
  });

  it('shows a failed list as an error with a reload, not as no sessions', async () => {
    answers['GET /api/v1/auth/sessions'] = () => json({ error: 'unavailable' }, 503);
    renderAccount();
    expect(await screen.findByText('Failed to load sessions')).toBeInTheDocument();
    expect(screen.queryByText('No active sessions.')).toBeNull();

    answers['GET /api/v1/auth/sessions'] = () => json([session('s1', 'Firefox on Linux')]);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(await screen.findByText('Firefox on Linux')).toBeInTheDocument();
  });

  it('shows a failed revoke', async () => {
    answers['POST /api/v1/auth/sessions/s2/revoke'] = () => json({ error: 'not_found' }, 404);
    renderAccount();
    await screen.findByText('Safari on iPhone');
    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[1]!);
    await confirmWith('Revoke');
    expect(await screen.findByText('Failed to revoke the session: Request failed with status 404')).toBeInTheDocument();
  });

  it('shows a failed sign-out of the other sessions', async () => {
    answers['POST /api/v1/auth/sessions/revoke-others'] = () => json({ error: 'unavailable' }, 503);
    renderAccount();
    await screen.findByText('Safari on iPhone');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out other sessions' }));
    await confirmWith('Sign out other sessions');
    expect(
      await screen.findByText('Failed to sign out the other sessions: Request failed with status 503'),
    ).toBeInTheDocument();
  });
});
