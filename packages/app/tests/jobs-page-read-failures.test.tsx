// @vitest-environment jsdom
// The Jobs page when a read fails: the saved jobs, the runs, or the definition of one entity. Each
// failure shows an error that names what failed; an empty list shows only when its read succeeded.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition } from '@digitaplatform/shared';
import { DialogHostProvider } from '@/components/overlay/DialogHost';
import { useSessionStore } from '@/stores/session';
import type { SessionUser } from '@/types';
import { JOBS_URL, type JobDef } from '@/services/jobs';
import JobsPage from '@/pages/JobsPage';

// Served at the root: the page reads its own engine at /api/v1 and names no app.
vi.hoisted(() => {
  (window as unknown as Record<string, unknown>).__APP_BASE_PATH__ = '';
});

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function entity(name: string, action: string, label: string): EntityDefinition {
  return { name, label: name, fields: [], actions: [{ action, label, long_running: true }] } as unknown as EntityDefinition;
}

const dunning: JobDef = {
  _id: 'j0',
  name: 'Nightly dunning',
  entity: 'Customer',
  doc: 'c1',
  action: 'sendDunning',
  params: {},
  schedule: { cron: '0 3 * * *' },
  enabled: true,
  on_behalf: { user: 'op@example.com', roles: ['Administrator'] },
  timeout_minutes: 60,
  max_attempts: 3,
  next_run_at: null,
  created_at: '2026-09-29T00:00:00Z',
};
const dunningRun = { _id: 'r0', job: 'j0', status: 'succeeded', attempt: 1, progress: null, triggered_by: 'dunning-operator', chunks: 1, error: null, created_at: '2026-09-29T03:00:00Z', started_at: null, finished_at: null, duration_ms: 1000 };

/** The GET routes of the jobs service and of the engine, by path; a test plants a failure. */
let routes: Record<string, () => Response> = {};

beforeEach(() => {
  routes = {
    '/api/v1/apps': () => json({ apps: [], default: null }),
    '/api/v1/jobs': () => json({ jobs: [dunning] }),
    '/api/v1/runs': () => json({ runs: [dunningRun] }),
    '/api/v1/meta': () => ok([{ name: 'Customer' }, { name: 'Invoice' }]),
    '/api/v1/meta/Customer': () => ok(entity('Customer', 'sendDunning', 'Send dunning')),
    '/api/v1/meta/Invoice': () => ok(entity('Invoice', 'archiveInvoices', 'Archive invoices')),
  };
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const path = u.startsWith(JOBS_URL) ? u.slice(JOBS_URL.length) : new URL(u, window.location.origin).pathname;
    if ((init?.method ?? 'GET') === 'GET' && routes[path]) return routes[path]!();
    if (init?.method === 'POST' && path.endsWith('/run-now')) return json({ run: { _id: 'r1' } });
    throw new Error(`unexpected fetch: ${init?.method ?? 'GET'} ${u}`);
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

describe('the Jobs page when a read fails', () => {
  it('lists the tasks, the saved jobs and the runs when every read succeeds', async () => {
    renderJobs();
    expect(await screen.findByTestId('row:archiveInvoices')).toBeInTheDocument();
    expect(screen.getByTestId('row:sendDunning')).toBeInTheDocument();
    expect(await screen.findByText(dunning.name)).toBeInTheDocument();
    expect(await screen.findByText(/dunning-operator/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a failed read of the saved jobs as an error, not as no saved jobs', async () => {
    routes['/api/v1/jobs'] = () => json({ error: 'jobs store unavailable' }, 503);
    renderJobs();
    expect(await screen.findByText('Failed to load saved jobs')).toBeInTheDocument();
    expect(screen.getByText('jobs store unavailable')).toBeInTheDocument();
    await screen.findByTestId('row:sendDunning');
    expect(screen.queryByText('No saved jobs yet.')).toBeNull();
  });

  // The page reads the saved jobs again after every action and every 15 seconds.
  it('keeps the saved jobs it read beside the error when a later read fails', async () => {
    const yearEnd: JobDef = { ...dunning, _id: 'j9', name: 'Year-end close', entity: 'Ledger', action: 'closeYear' };
    routes['/api/v1/jobs'] = () => json({ jobs: [dunning, yearEnd] });
    renderJobs();
    expect(await screen.findByText(dunning.name)).toBeInTheDocument();
    expect(screen.getByText(yearEnd.name)).toBeInTheDocument();

    routes['/api/v1/jobs'] = () => json({ error: 'jobs store unavailable' }, 503);
    fireEvent.click(screen.getAllByTestId('action:job-run-now')[0]!);
    expect(await screen.findByText('Failed to load saved jobs')).toBeInTheDocument();
    expect(screen.getByText(dunning.name)).toBeInTheDocument();
    expect(screen.getByText(yearEnd.name)).toBeInTheDocument();
  });

  it('shows a failed read of the runs as an error, not as no runs', async () => {
    routes['/api/v1/runs'] = () => json({ error: 'runs store unavailable' }, 503);
    renderJobs();
    expect(await screen.findByText('Failed to load runs')).toBeInTheDocument();
    expect(screen.getByText('runs store unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('runs-empty')).toBeNull();
  });

  // The page reads the runs again after every action, and every 2 seconds while one is active.
  it('keeps the runs it read beside the error when a later read fails', async () => {
    renderJobs();
    expect(await screen.findByText(/dunning-operator/)).toBeInTheDocument();
    await screen.findByText(dunning.name);

    routes['/api/v1/runs'] = () => json({ error: 'runs store unavailable' }, 503);
    fireEvent.click(screen.getAllByTestId('action:job-run-now')[0]!);
    expect(await screen.findByText('Failed to load runs')).toBeInTheDocument();
    expect(screen.getByText(/dunning-operator/)).toBeInTheDocument();
  });

  it("names the entity whose definition failed and keeps the other entities' tasks", async () => {
    routes['/api/v1/meta/Invoice'] = () => json({ message: 'meta store unavailable' }, 500);
    renderJobs();
    expect(await screen.findByText('Failed to load the tasks of Invoice')).toBeInTheDocument();
    expect(screen.getByText('meta store unavailable')).toBeInTheDocument();
    expect(screen.getByTestId('row:sendDunning')).toBeInTheDocument();
    expect(screen.queryByTestId('row:archiveInvoices')).toBeNull();
  });
});
