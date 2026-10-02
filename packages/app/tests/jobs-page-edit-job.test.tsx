// @vitest-environment jsdom
// A jobs admin edits a saved job on the Jobs page: the dialog opens with the job's name, document,
// params and cron, and saves through PUT. PUT replaces the job on the jobs service, so what the
// dialog does not show (its app, whether it is enabled, its timeout and attempts) goes back as it was.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition } from '@digitaplatform/shared';
import { DialogHostProvider } from '@/components/overlay/DialogHost';
import { useSessionStore } from '@/stores/session';
import type { SessionUser } from '@/types';
import { JOBS_URL, type JobDef } from '@/services/jobs';
import JobsPage from '@/pages/JobsPage';

// Served at the root: the page names no app of its own.
vi.hoisted(() => {
  (window as unknown as Record<string, unknown>).__APP_BASE_PATH__ = '';
});

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
const json = (body: unknown) => new Response(JSON.stringify(body));

const customer = {
  name: 'Customer',
  label: 'Customer',
  fields: [],
  actions: [
    {
      action: 'sendDunning',
      label: 'Send dunning',
      long_running: true,
      params: [{ name: 'days', type: 'int', label: 'Days overdue', min: 1 }],
    },
  ],
} as unknown as EntityDefinition;

// Scheduled from the erp app's page, disabled for now, with the limits an API client gave it.
const nightly: JobDef = {
  _id: 'j0',
  name: 'Nightly dunning',
  entity: 'Customer',
  doc: 'c1',
  action: 'sendDunning',
  app: 'erp',
  params: { days: 30 },
  schedule: { cron: '0 3 * * *' },
  enabled: false,
  on_behalf: { user: 'op@example.com', roles: ['Administrator'] },
  timeout_minutes: 120,
  max_attempts: 5,
  next_run_at: null,
  created_at: '2026-09-29T00:00:00Z',
};
const manual: JobDef = { ...nightly, _id: 'j1', name: 'Dunning of c2', doc: 'c2', app: undefined, params: { days: 7 }, schedule: null, enabled: true, timeout_minutes: 60, max_attempts: 3 };

/** Every save the page sent: method, path and parsed body. */
let saves: { method: string; path: string; body: Record<string, unknown> }[] = [];

const routes: Record<string, () => Response> = {
  '/api/v1/apps': () => json({ apps: [], default: null }),
  '/api/v1/jobs': () => json({ jobs: [nightly, manual] }),
  '/api/v1/runs': () => json({ runs: [] }),
  '/api/v1/meta': () => ok([{ name: 'Customer' }]),
  '/api/v1/meta/Customer': () => ok(customer),
};

beforeEach(() => {
  saves = [];
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const path = u.startsWith(JOBS_URL) ? u.slice(JOBS_URL.length) : new URL(u, window.location.origin).pathname;
    if (method === 'GET' && routes[path]) return routes[path]!();
    if (method === 'POST' || method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      saves.push({ method, path, body });
      return json({ job: { ...nightly, ...body } });
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

/** Open the dialog of a saved job through its Edit button. */
async function editJob(name: string) {
  const row = (await screen.findByText(name)).closest('li')!;
  fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
  return screen.findByRole('dialog');
}

describe('editing a saved job on the Jobs page', () => {
  it('opens the dialog with the job and saves it through PUT, keeping what the dialog does not show', async () => {
    renderJobs();
    const dialog = await editJob(nightly.name);
    expect(within(dialog).getByLabelText('Job name')).toHaveValue('Nightly dunning');
    expect(within(dialog).getByLabelText(/^Target document/)).toHaveValue('c1');
    expect(within(dialog).getByLabelText('Days overdue')).toHaveValue(30);
    expect(within(dialog).getByLabelText(/^Cron/)).toHaveValue('0 3 * * *');

    fireEvent.change(within(dialog).getByLabelText(/^Cron/), { target: { value: '0 4 * * 1' } });
    fireEvent.change(within(dialog).getByLabelText('Days overdue'), { target: { value: '45' } });
    fireEvent.click(within(dialog).getByTestId('action:job-save'));

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toEqual({
      method: 'PUT',
      path: '/api/v1/jobs/j0',
      body: {
        name: 'Nightly dunning',
        entity: 'Customer',
        doc: 'c1',
        action: 'sendDunning',
        app: 'erp',
        params: { days: 45 },
        schedule: { cron: '0 4 * * 1' },
        enabled: false,
        timeout_minutes: 120,
        max_attempts: 5,
      },
    });
  });

  it('saves an edited manual job without a schedule when the cron stays empty', async () => {
    renderJobs();
    const dialog = await editJob(manual.name);
    expect(within(dialog).getByLabelText(/^Cron/)).toHaveValue('');
    fireEvent.change(within(dialog).getByLabelText('Days overdue'), { target: { value: '14' } });
    fireEvent.click(within(dialog).getByTestId('action:job-save'));

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ method: 'PUT', path: '/api/v1/jobs/j1', body: { doc: 'c2', params: { days: 14 }, schedule: null } });
    expect(saves[0]!.body).not.toHaveProperty('app');
  });

  it('still creates a new job from the task, with a cron it requires', async () => {
    renderJobs();
    fireEvent.click(await screen.findByTestId('action:task-schedule-sendDunning'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Target document/), { target: { value: 'c3' } });
    expect(within(dialog).getByTestId('action:job-save')).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/^Cron/), { target: { value: '0 5 * * *' } });
    fireEvent.click(within(dialog).getByTestId('action:job-save'));

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ method: 'POST', path: '/api/v1/jobs', body: { doc: 'c3', schedule: { cron: '0 5 * * *' } } });
  });

  it('names the cron required on a new job, and empty for a manual run only on a saved one', async () => {
    renderJobs();
    fireEvent.click(await screen.findByTestId('action:task-schedule-sendDunning'));
    const created = await screen.findByRole('dialog');
    expect(within(created).getByText('Cron (required)')).toBeInTheDocument();
    expect(within(created).queryByText('Cron (empty = manual only)')).toBeNull();
    expect(within(created).getByLabelText(/^Cron/)).toBeRequired();
    fireEvent.click(within(created).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const edited = await editJob(manual.name);
    expect(within(edited).getByText('Cron (empty = manual only)')).toBeInTheDocument();
    expect(within(edited).getByLabelText(/^Cron/)).not.toBeRequired();
  });
});
