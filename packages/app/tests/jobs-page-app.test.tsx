// @vitest-environment jsdom
// The Jobs page of a tenant with several apps, this page served under /erp: the operator picks the
// app, the task catalog is read from the chosen app's engine at /<app>/api/v1, and every job the
// page saves names that app (digita-platform#69). jobs-page-root.test.tsx covers the same page
// served at the root.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition } from '@digitaplatform/shared';
import { DialogHostProvider } from '@/components/overlay/DialogHost';
import { useSessionStore } from '@/stores/session';
import type { SessionUser } from '@/types';
import { JOBS_URL, type JobDef } from '@/services/jobs';
import JobsPage from '@/pages/JobsPage';

// This page is the erp app's, served under /erp (lib/appBase.ts reads it at module load).
vi.hoisted(() => {
  (window as unknown as Record<string, unknown>).__APP_BASE_PATH__ = '/erp';
});

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
const json = (body: unknown) => new Response(JSON.stringify(body));

function entity(name: string, action: string, label: string): EntityDefinition {
  return { name, label: name, fields: [], actions: [{ action, label, long_running: true }] } as unknown as EntityDefinition;
}

const savedSweep: JobDef = {
  _id: 'j1',
  name: 'Delete expired contact requests',
  entity: 'WebSite',
  doc: 'simetrix',
  action: 'deleteExpiredContactRequests',
  app: 'simetrix-ch',
  params: {},
  schedule: null,
  enabled: true,
  on_behalf: { user: 'op@example.com', roles: ['Administrator'] },
  timeout_minutes: 60,
  max_attempts: 3,
  next_run_at: null,
  created_at: '2026-09-29T00:00:00Z',
};
// A job saved before the jobs service named apps: it runs on the default app's engine.
const savedDunning: JobDef = { ...savedSweep, _id: 'j0', name: 'Dunning run', entity: 'Customer', doc: 'c1', action: 'sendDunning', app: undefined };

const run = (job: string, triggered_by: string) =>
  ({ _id: `run-${job}`, job, status: 'succeeded', attempt: 1, progress: null, triggered_by, chunks: 1, error: null, created_at: '2026-09-29T03:00:00Z', started_at: null, finished_at: null, duration_ms: 1000 });

/** Fastify's answer for a route the running jobs release does not have. */
const notFound = (path: string) =>
  new Response(JSON.stringify({ message: `Route GET:${path} not found`, error: 'Not Found', statusCode: 404 }), { status: 404 });

/** Every save the page sent: method, path and parsed body. */
let saves: { method: string; path: string; body: Record<string, unknown> }[] = [];

/** The GET routes of the jobs service and of the apps' engines, by path; a test overrides one to plant a failure. */
let routes: Record<string, () => Response> = {};

function multiAppRoutes(): Record<string, () => Response> {
  return {
    '/api/v1/apps': () => json({ apps: ['digitaplatform-com', 'erp', 'simetrix-ch'], default: 'erp' }),
    '/api/v1/jobs': () => json({ jobs: [savedDunning, savedSweep] }),
    '/api/v1/runs': () => json({ runs: [run('j0', 'erp-operator'), run('j1', 'sweep-operator'), run('gone', 'deleted-job-operator')] }),
    // Each app's catalog comes from that app's engine on the tenant host.
    '/erp/api/v1/meta': () => ok([{ name: 'Customer' }]),
    '/erp/api/v1/meta/Customer': () => ok(entity('Customer', 'sendDunning', 'Send dunning')),
    '/simetrix-ch/api/v1/meta': () => ok([{ name: 'WebSite' }]),
    '/simetrix-ch/api/v1/meta/WebSite': () => ok(entity('WebSite', 'deleteExpiredContactRequests', 'Delete expired contact requests')),
  };
}

function fakeJobsWorld(url: string, init?: RequestInit): Response {
  const method = init?.method ?? 'GET';
  // The page's own engine is read relative (under /erp); another app's at an absolute URL.
  const path = url.startsWith(JOBS_URL) ? url.slice(JOBS_URL.length) : new URL(url, window.location.origin).pathname;
  if (method === 'GET' && routes[path]) return routes[path]!();
  if (method === 'POST' || method === 'PUT') {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    saves.push({ method, path, body });
    if (path.endsWith('/run-now')) return json({ run: { _id: 'r1' } });
    return json({ job: { ...savedSweep, ...body, _id: path === '/api/v1/jobs' ? 'j2' : 'j1' } });
  }
  throw new Error(`unexpected fetch: ${method} ${url}`);
}

beforeEach(() => {
  saves = [];
  routes = multiAppRoutes();
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => fakeJobsWorld(String(url), init));
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

async function pickApp(name: string) {
  const picker = await screen.findByTestId('jobs-app');
  fireEvent.click(picker.querySelector('[data-ui="select-trigger"]')!);
  fireEvent.click(screen.getByRole('option', { name }));
}

describe('the Jobs page of a tenant with several apps', () => {
  it('offers the apps, the default preselected, and lists the tasks of the chosen app', async () => {
    renderJobs();
    expect(await screen.findByTestId('row:sendDunning')).toBeInTheDocument();
    const picker = await screen.findByTestId('jobs-app');
    expect(picker.querySelector('[data-ui="select-trigger"]')).toHaveTextContent('erp');
    fireEvent.click(picker.querySelector('[data-ui="select-trigger"]')!);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['digitaplatform-com', 'erp', 'simetrix-ch']);

    fireEvent.click(screen.getByRole('option', { name: 'simetrix-ch' }));
    expect(await screen.findByTestId('row:deleteExpiredContactRequests')).toBeInTheDocument();
    expect(screen.queryByTestId('row:sendDunning')).toBeNull();
    // The saved sweep of the website shows under its task (the task label and the job name).
    expect(screen.getAllByText(savedSweep.name)).toHaveLength(2);
  });

  it('shows a job without app under the default app', async () => {
    renderJobs();
    expect(await screen.findByText(savedDunning.name)).toBeInTheDocument();
    await pickApp('simetrix-ch');
    await screen.findByTestId('row:deleteExpiredContactRequests');
    expect(screen.queryByText(savedDunning.name)).toBeNull();
  });

  it('shows the runs of the chosen app, and of jobs that are gone, not those of another app', async () => {
    renderJobs();
    expect(await screen.findByText(/erp-operator/)).toBeInTheDocument();
    expect(screen.getByText(/deleted-job-operator/)).toBeInTheDocument();
    expect(screen.queryByText(/sweep-operator/)).toBeNull();

    await pickApp('simetrix-ch');
    expect(await screen.findByText(/sweep-operator/)).toBeInTheDocument();
    expect(screen.queryByText(/erp-operator/)).toBeNull();
  });

  // What the tenant host answers today at /<site>/api/v1 for a website member: digita-deploy routes
  // /<app>/api to the engine for charts/digita-app fronts only, and the site's Next.js 404 page comes back.
  it('shows a failed catalog read of the chosen app as an error, not as an empty catalog', async () => {
    routes['/simetrix-ch/api/v1/meta'] = () =>
      new Response('<!DOCTYPE html><html><body>404</body></html>', { status: 404, headers: { 'content-type': 'text/html' } });
    renderJobs();
    await pickApp('simetrix-ch');
    expect(await screen.findByText('Request failed with status 404')).toBeInTheDocument();
    expect(screen.queryByTestId('jobs-empty')).toBeNull();
  });

  it('schedules a job that names the chosen app', async () => {
    renderJobs();
    await pickApp('simetrix-ch');
    fireEvent.click(await screen.findByTestId('action:task-schedule-deleteExpiredContactRequests'));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText(/^Target document/), { target: { value: 'simetrix' } });
    fireEvent.change(screen.getByLabelText(/^Cron/), { target: { value: '0 3 * * *' } });
    fireEvent.click(screen.getByTestId('action:job-save'));

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({
      method: 'POST',
      path: '/api/v1/jobs',
      body: { entity: 'WebSite', doc: 'simetrix', action: 'deleteExpiredContactRequests', app: 'simetrix-ch', schedule: { cron: '0 3 * * *' } },
    });
  });

  it('creates the manual job of a first run with the chosen app', async () => {
    routes['/api/v1/jobs'] = () => json({ jobs: [] });
    renderJobs();
    await pickApp('simetrix-ch');
    fireEvent.click(await screen.findByTestId('action:task-run-deleteExpiredContactRequests'));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText(/^Target document/), { target: { value: 'simetrix' } });
    fireEvent.click(screen.getByTestId('action:job-save'));

    await waitFor(() => expect(saves.map((s) => s.path)).toEqual(['/api/v1/jobs', '/api/v1/jobs/j2/run-now']));
    expect(saves[0]).toMatchObject({ method: 'POST', body: { action: 'deleteExpiredContactRequests', app: 'simetrix-ch' } });
  });

  // PUT replaces the job on the jobs service: a body without `app` would move the sweep to erp's engine.
  it('keeps the app of a saved job when running it again', async () => {
    renderJobs();
    await pickApp('simetrix-ch');
    fireEvent.click(await screen.findByTestId('action:task-run-deleteExpiredContactRequests'));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText(/^Target document/), { target: { value: 'simetrix' } });
    fireEvent.click(screen.getByTestId('action:job-save'));

    await waitFor(() => expect(saves.map((s) => s.path)).toEqual(['/api/v1/jobs/j1', '/api/v1/jobs/j1/run-now']));
    expect(saves[0]!.method).toBe('PUT');
    expect(saves[0]!.body.app).toBe('simetrix-ch');
  });

  it('names the default app when it saves a job that had none', async () => {
    renderJobs();
    fireEvent.click(await screen.findByTestId('action:task-run-sendDunning'));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText(/^Target document/), { target: { value: 'c1' } });
    fireEvent.click(screen.getByTestId('action:job-save'));

    await waitFor(() => expect(saves.map((s) => s.path)).toEqual(['/api/v1/jobs/j0', '/api/v1/jobs/j0/run-now']));
    expect(saves[0]!.body.app).toBe('erp');
  });

  // The chart can leave ENGINE_URL outside ENGINE_URLS: then no app is the default, and a job
  // without app would otherwise vanish from every choice.
  describe('when the service names no default', () => {
    beforeEach(() => {
      routes['/api/v1/apps'] = () => json({ apps: ['buildproject', 'erp', 'simetrix-ch'], default: null });
    });

    it('preselects this app, not the first of the list', async () => {
      renderJobs();
      expect(await screen.findByTestId('row:sendDunning')).toBeInTheDocument();
      expect((await screen.findByTestId('jobs-app')).querySelector('[data-ui="select-trigger"]')).toHaveTextContent('erp');
    });

    it('shows a job without app under every app', async () => {
      renderJobs();
      expect(await screen.findByText(savedDunning.name)).toBeInTheDocument();
      await pickApp('simetrix-ch');
      await screen.findByTestId('row:deleteExpiredContactRequests');
      expect(screen.getByText(savedDunning.name)).toBeInTheDocument();
    });

    // PUT replaces the job: reusing the manual job that runs on the default engine would move it to the chosen app.
    it('runs the task as a new job of the chosen app instead of moving the job without app', async () => {
      renderJobs();
      fireEvent.click(await screen.findByTestId('action:task-run-sendDunning'));
      await screen.findByRole('dialog');
      fireEvent.change(screen.getByLabelText(/^Target document/), { target: { value: 'c1' } });
      fireEvent.click(screen.getByTestId('action:job-save'));

      await waitFor(() => expect(saves.map((s) => s.path)).toEqual(['/api/v1/jobs', '/api/v1/jobs/j2/run-now']));
      expect(saves[0]).toMatchObject({ method: 'POST', body: { action: 'sendDunning', app: 'erp' } });
    });
  });

  // An app can leave the tenant while its jobs remain (ENGINE_URLS loses the entry).
  it('shows a job of an app the tenant no longer has under every app, and its runs', async () => {
    const orphan: JobDef = { ...savedSweep, _id: 'j3', name: 'Nightly build', entity: 'Build', action: 'runBuild', app: 'buildproject' };
    routes['/api/v1/jobs'] = () => json({ jobs: [savedDunning, savedSweep, orphan] });
    routes['/api/v1/runs'] = () => json({ runs: [run('j3', 'build-operator')] });
    renderJobs();
    expect(await screen.findByText(orphan.name)).toBeInTheDocument();
    expect(screen.getByText(/build-operator/)).toBeInTheDocument();
    await pickApp('simetrix-ch');
    await screen.findByTestId('row:deleteExpiredContactRequests');
    expect(screen.getByText(orphan.name)).toBeInTheDocument();
    expect(screen.getByText(/build-operator/)).toBeInTheDocument();
  });
});

// A tenant with one app sees the page as before the jobs service named apps: no picker, its own
// engine's tasks; a scheduled job names the one app, which is the default the service runs it on.
describe('the Jobs page of a tenant with one app', () => {
  beforeEach(() => {
    routes['/api/v1/apps'] = () => json({ apps: ['erp'], default: 'erp' });
  });

  it("lists this app's tasks without a picker and schedules a job that names the app", async () => {
    renderJobs();
    expect(await screen.findByTestId('row:sendDunning')).toBeInTheDocument();
    expect(screen.queryByTestId('jobs-app')).toBeNull();
    fireEvent.click(screen.getByTestId('action:task-schedule-sendDunning'));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText(/^Target document/), { target: { value: 'c1' } });
    fireEvent.change(screen.getByLabelText(/^Cron/), { target: { value: '0 3 * * *' } });
    fireEvent.click(screen.getByTestId('action:job-save'));

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ method: 'POST', path: '/api/v1/jobs', body: { action: 'sendDunning', app: 'erp' } });
  });
});

// Editing a saved job on a page where an app is chosen: PUT replaces the job, so the body carries
// what the dialog does not show as the job has it, and the toast tells what the save did.
describe('editing a saved job of the chosen app', () => {
  const scheduledSweep: JobDef = { ...savedSweep, schedule: { cron: '0 3 * * *' }, enabled: false, timeout_minutes: 15, max_attempts: 7 };

  beforeEach(() => {
    routes['/api/v1/jobs'] = () => json({ jobs: [savedDunning, scheduledSweep] });
  });

  async function editSweep() {
    renderJobs();
    await pickApp('simetrix-ch');
    fireEvent.click(await screen.findByTestId('action:job-edit'));
    await screen.findByRole('dialog');
  }

  // The job's app left the tenant, so the job shows under the chosen app; the edit must not move it there.
  it("keeps the job's own app, enabled and limits in the PUT body, not the chosen app", async () => {
    const leftApp: JobDef = { ...scheduledSweep, app: 'old-site' };
    routes['/api/v1/jobs'] = () => json({ jobs: [savedDunning, leftApp] });
    await editSweep();
    fireEvent.change(screen.getByLabelText(/^Cron/), { target: { value: '0 4 * * *' } });
    fireEvent.click(screen.getByTestId('action:job-save'));

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toEqual({
      method: 'PUT',
      path: '/api/v1/jobs/j1',
      body: {
        name: 'Delete expired contact requests',
        entity: 'WebSite',
        doc: 'simetrix',
        action: 'deleteExpiredContactRequests',
        app: 'old-site',
        params: {},
        schedule: { cron: '0 4 * * *' },
        enabled: false,
        timeout_minutes: 15,
        max_attempts: 7,
      },
    });
  });

  it('says the schedule is saved when the cron changes', async () => {
    await editSweep();
    fireEvent.change(screen.getByLabelText(/^Cron/), { target: { value: '0 4 * * *' } });
    fireEvent.click(screen.getByTestId('action:job-save'));

    expect(await screen.findByText('Schedule saved.')).toBeInTheDocument();
    expect(screen.queryByText('Saved. The job now runs only when started by hand.')).toBeNull();
    expect(saves[0]!.body.schedule).toEqual({ cron: '0 4 * * *' });
  });

  it('says a job made by Run now still runs only by hand after an edit without a cron', async () => {
    renderJobs();
    fireEvent.click(await screen.findByTestId('action:job-edit'));
    await screen.findByRole('dialog');
    expect(screen.getByLabelText(/^Cron/)).toHaveValue('');
    fireEvent.click(screen.getByTestId('action:job-save'));

    expect(await screen.findByText('Saved. The job now runs only when started by hand.')).toBeInTheDocument();
    expect(screen.queryByText('Schedule saved.')).toBeNull();
    expect(saves[0]!.body.schedule).toBeNull();
  });

  it('says the job now runs only by hand when the cron is cleared', async () => {
    await editSweep();
    fireEvent.change(screen.getByLabelText(/^Cron/), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('action:job-save'));

    expect(await screen.findByText('Saved. The job now runs only when started by hand.')).toBeInTheDocument();
    expect(screen.queryByText('Schedule saved.')).toBeNull();
    expect(saves[0]!.body.schedule).toBeNull();
  });
});

// The definitions of a catalog are read together, and one that fails does not fail the read: the
// page must read it again on Reload and must not keep a result with failures as fresh.
describe('a definition read that fails on the Jobs page', () => {
  /** Mounts the page on a client the test keeps, so a second mount sees what the first one cached. */
  function mountJobs(qc: QueryClient) {
    return render(
      <QueryClientProvider client={qc}>
        <DialogHostProvider>
          <JobsPage />
        </DialogHostProvider>
      </QueryClientProvider>,
    );
  }

  /** Answers the Customer definition with a failure the first `failures` times, then with the definition. */
  function countCustomerReads(failures: number): { count: number } {
    const reads = { count: 0 };
    const answer = routes['/erp/api/v1/meta/Customer']!;
    routes['/erp/api/v1/meta/Customer'] = () => {
      reads.count += 1;
      return reads.count <= failures
        ? new Response(JSON.stringify({ message: 'meta store unavailable' }), { status: 500 })
        : answer();
    };
    return reads;
  }

  it('shows the error, and the task after Reload', async () => {
    countCustomerReads(1);
    mountJobs(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    expect(await screen.findByText('Failed to load the tasks of Customer')).toBeInTheDocument();
    expect(screen.queryByTestId('row:sendDunning')).toBeNull();

    fireEvent.click(screen.getByTestId('action:jobs-tasks-reload'));
    expect(await screen.findByTestId('row:sendDunning')).toBeInTheDocument();
    expect(screen.queryByText('Failed to load the tasks of Customer')).toBeNull();
  });

  it('lists two failed reads above one Reload, which waits while the definitions are read again', async () => {
    routes['/erp/api/v1/meta'] = () => ok([{ name: 'Customer' }, { name: 'Supplier' }]);
    const failed = () => new Response(JSON.stringify({ message: 'meta store unavailable' }), { status: 500 });
    routes['/erp/api/v1/meta/Customer'] = failed;
    routes['/erp/api/v1/meta/Supplier'] = failed;
    mountJobs(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    expect(await screen.findByText('Failed to load the tasks of Customer')).toBeInTheDocument();
    expect(screen.getByText('Failed to load the tasks of Supplier')).toBeInTheDocument();
    const reload = screen.getByTestId('action:jobs-tasks-reload');
    expect(reload).toBeEnabled();

    // The second read hangs, so the page shows it as running and takes no second click.
    let release!: () => void;
    const hung = new Promise<void>((resolve) => (release = resolve));
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('/api/v1/meta/')) await hung;
      return fakeJobsWorld(String(url), init);
    });
    fireEvent.click(reload);
    await waitFor(() => expect(screen.getByTestId('action:jobs-tasks-reload')).toBeDisabled());
    release();
    await waitFor(() => expect(screen.getByTestId('action:jobs-tasks-reload')).toBeEnabled());
  });

  it('reads a result with failures again when the page opens again', async () => {
    const reads = countCustomerReads(1);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = mountJobs(qc);
    expect(await screen.findByText('Failed to load the tasks of Customer')).toBeInTheDocument();
    first.unmount();

    mountJobs(qc);
    expect(await screen.findByTestId('row:sendDunning')).toBeInTheDocument();
    expect(reads.count).toBe(2);
  });

  it('reads a catalog without failures once', async () => {
    const reads = countCustomerReads(0);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = mountJobs(qc);
    expect(await screen.findByTestId('row:sendDunning')).toBeInTheDocument();
    first.unmount();

    mountJobs(qc);
    expect(await screen.findByTestId('row:sendDunning')).toBeInTheDocument();
    expect(reads.count).toBe(1);
  });
});

// A jobs release without GET /api/v1/apps (before digita-jobs 0.3.004) answers 404; a tenant without
// apps (ENGINE_URLS unset, a legacy render) answers no apps. Either way the page has no app to name
// and works as it did before: this app's engine's tasks, every job, saves without `app`.
describe.each([
  ['a jobs release without GET /api/v1/apps', () => notFound('/api/v1/apps')],
  ['a jobs service that names no apps', () => json({ apps: [], default: null })],
])('the Jobs page against %s', (_name, appsRoute) => {
  beforeEach(() => {
    routes['/api/v1/apps'] = appsRoute;
  });

  it("lists this app's engine's tasks and every job, without a picker", async () => {
    renderJobs();
    expect(await screen.findByTestId('row:sendDunning')).toBeInTheDocument();
    expect(screen.queryByTestId('jobs-app')).toBeNull();
    expect(screen.queryByText(/not found/)).toBeNull();
    expect(screen.getByText(savedDunning.name)).toBeInTheDocument();
    expect(screen.getByText(savedSweep.name)).toBeInTheDocument();
  });

  it('saves a job without app', async () => {
    renderJobs();
    fireEvent.click(await screen.findByTestId('action:task-schedule-sendDunning'));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText(/^Target document/), { target: { value: 'c1' } });
    fireEvent.change(screen.getByLabelText(/^Cron/), { target: { value: '0 3 * * *' } });
    fireEvent.click(screen.getByTestId('action:job-save'));

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ method: 'POST', body: { action: 'sendDunning' } });
    expect(saves[0]!.body).not.toHaveProperty('app');
  });
});
