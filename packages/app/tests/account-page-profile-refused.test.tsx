// @vitest-environment jsdom
// A profile save the IdP refuses names the IdP's reason at the profile card, as the sessions card
// names its own, when the IdP sent a text for the person; every other refusal and a server failure
// keep the general sentence.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { sessionCookieNames } from '@digitaplatform/shared';
import { DialogHostProvider } from '@/components/overlay/DialogHost';
import { useSessionStore } from '@/stores/session';
import { AUTH_COOKIE_SUFFIX } from '@/lib/authConfig';
import type { SessionUser } from '@/types';
import AccountPage from '@/pages/AccountPage';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let profileAnswer: () => Response;

beforeEach(() => {
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    writable: true,
    value: `${sessionCookieNames(AUTH_COOKIE_SUFFIX).CSRF}=csrf-123`,
  });
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${init?.method ?? 'GET'} ${new URL(String(url), window.location.origin).pathname}`;
    if (route === 'GET /api/v1/auth/sessions') return json([]);
    if (route === 'POST /api/v1/auth/profile') return profileAnswer();
    throw new Error(`unexpected fetch: ${route}`);
  });
  useSessionStore.setState({ user: { _id: 'u1', email: 'ada@example.com', roles: [], full_name: 'Ada' } as SessionUser, languages: [] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useSessionStore.setState({ user: null });
});

async function saveName(name: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <DialogHostProvider>
        <AccountPage />
      </DialogHostProvider>
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }));
}

describe('a profile save the IdP refuses', () => {
  it("PLANTED DEFECT: names the IdP's reason at the profile card, not 'Something went wrong'", async () => {
    const reason = 'Not available in the demo: every visitor signs in as the same demo user.';
    profileAnswer = () => json({ error: 'demo_session_forbidden', message: reason }, 403);
    await saveName('Ada Example');
    expect(await screen.findByText(reason)).toBeInTheDocument();
  });

  it('keeps the general sentence for a server failure, whose text names nothing to act on', async () => {
    profileAnswer = () => json({ error: 'internal', message: 'connect ECONNREFUSED 10.0.0.7:27017' }, 500);
    await saveName('Ada Example');
    expect(await screen.findByRole('alert')).not.toHaveTextContent('ECONNREFUSED');
  });

  // The IdP's own refusals and the schema's carry a code alone; its translator answers a code it
  // has no text for with the code itself, as the rate limit's sentence shows.
  it.each([
    [400, { error: 'full_name: Too big: expected string to have <=200 characters' }],
    [400, { error: 'demo_session_required' }],
    [403, { error: 'csrf_failed' }],
    [404, { error: 'not_found' }],
    [429, { error: 'Rate limit exceeded, retry in 1 minute', message: 'Rate limit exceeded, retry in 1 minute' }],
  ])('PLANTED DEFECT: keeps the general sentence for a %i that sends no text for the person', async (status, body) => {
    profileAnswer = () => json(body, status);
    await saveName('Ada Example');
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Something went wrong$/);
  });

  it('PLANTED DEFECT: takes no longer name than the IdP keeps', async () => {
    profileAnswer = () => json({ error: 'unexpected' }, 400);
    await saveName('Ada Example');
    expect(screen.getByLabelText('Full name')).toHaveAttribute('maxLength', '200');
  });
});
