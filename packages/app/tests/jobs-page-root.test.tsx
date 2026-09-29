// @vitest-environment jsdom
// The Jobs page served at the root (dev, a host-routed render): no base path names this app, and
// no other app's engine is reachable by path. The page reads its own engine at /api/v1, offers no
// picker, and saves without `app`, whatever the jobs service names (digita-platform#69).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition } from '@digitaplatform/shared';
import { DialogHostProvider } from '@/components/overlay/DialogHost';
import { useSessionStore } from '@/stores/session';
import type { SessionUser } from '@/types';
import { JOBS_URL } from '@/services/jobs';
import JobsPage from '@/pages/JobsPage';

// The dev env.js (public/env.js) leaves the base path empty; lib/appBase.ts reads it at module load.
vi.hoisted(() => {
  (window as unknown as Record<string, unknown>).__APP_BASE_PATH__ = '';
});

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
const json = (body: unknown) => new Response(JSON.stringify(body));
const customer = { name: 'Customer', label: 'Customer', fields: [], actions: [{ action: 'sendDunning', label: 'Send dunning', long_running: true }] } as unknown as EntityDefinition;

/** Every GET the page sent, by path, and every save. */
let gets: string[] = [];
let saves: { method: string; path: string; body: Record<string, unknown> }[] = [];

// digita-jobs/.env.example in dev: ENGINE_URLS={"erp": <the engine vite proxies /api to>}.
const routes: Record<string, () => Response> = {
  '/api/v1/apps': () => json({ apps: ['erp'], default: 'erp' }),
  '/api/v1/jobs': () => json({ jobs: [] }),
  '/api/v1/runs': () => json({ runs: [] }),
  '/api/v1/meta': () => ok([{ name: 'Customer' }]),
  '/api/v1/meta/Customer': () => ok(customer),
};

beforeEach(() => {
  gets = [];
  saves = [];
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const path = u.startsWith(JOBS_URL) ? u.slice(JOBS_URL.length) : new URL(u, window.location.origin).pathname;
    if (method === 'GET') {
      gets.push(path);
      if (routes[path]) return routes[path]!();
    }
    if (method === 'POST') {
      saves.push({ method, path, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return json({ job: { _id: 'j1' } });
    }
    throw new Error(`unexpected fetch: ${method} ${u}`);
  });
  useSessionStore.setState({ user: { _id: 'u1', email: 'op@example.com', roles: ['Administrator'] } as SessionUser });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useSessionStore.setState({ user: null });
});

function renderJobs() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DialogHostProvider>
        <JobsPage />
      </DialogHostProvider>
    </QueryClientProvider>,
  );
}

describe('the Jobs page served at the root', () => {
  it("reads its own engine's catalog at /api/v1 and offers no picker", async () => {
    renderJobs();
    expect(await screen.findByTestId('row:sendDunning')).toBeInTheDocument();
    expect(screen.queryByTestId('jobs-app')).toBeNull();
    expect(gets).toContain('/api/v1/meta');
    expect(gets.some((p) => p.startsWith('/erp/'))).toBe(false);
  });

  it('saves a job without app', async () => {
    renderJobs();
    fireEvent.click(await screen.findByTestId('action:task-schedule-sendDunning'));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText(/^Target document/), { target: { value: 'c1' } });
    fireEvent.change(screen.getByLabelText(/^Cron/), { target: { value: '0 3 * * *' } });
    fireEvent.click(screen.getByTestId('action:job-save'));

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ method: 'POST', path: '/api/v1/jobs', body: { action: 'sendDunning' } });
    expect(saves[0]!.body).not.toHaveProperty('app');
  });
});
