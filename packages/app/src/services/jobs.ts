import type { ActionDefinition, ApiResponse, EntityDefinition } from '@digitaplatform/shared';
import type { EntitySummary } from '@/types';
import { api, buildHeaders } from '@/services/api';
import { APP_BASE_PATH } from '@/lib/appBase';

/**
 * Client for the per-tenant digita-jobs satellite. The UI probes /health once
 * per session — no service, no jobs UI (menu entry and route stay hidden). Auth
 * rides the tenant session cookie (verified by the satellite via JWKS), and a
 * mutation carries the CSRF header the satellite checks, as an engine call does.
 */

export interface JobDef {
  _id: string;
  name: string;
  entity: string;
  doc?: string;
  action: string;
  /** The tenant app whose engine runs the job; absent = the jobs service's default app (JobApps.default). */
  app?: string;
  params: Record<string, unknown>;
  schedule: { cron: string } | null;
  enabled: boolean;
  on_behalf: { user: string; roles: string[]; name?: string };
  timeout_minutes: number;
  max_attempts: number;
  next_run_at: string | null;
  created_at: string;
}

export interface JobRun {
  _id: string;
  job: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  attempt: number;
  progress: { completed: number; total?: number; message?: string } | null;
  triggered_by: string;
  chunks: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
}

export interface JobInput {
  name: string;
  entity: string;
  doc: string;
  action: string;
  /**
   * A new job and the run of a task name the app the page shows, and an edit names the job's own
   * app: PUT replaces the job, so a body without `app` moves it to the default engine. Absent where
   * there is no app to name: the jobs service names none, this app is served at the root (ownApp),
   * or the edited job has none.
   */
  app?: string;
  params?: Record<string, unknown>;
  schedule?: { cron: string } | null;
  enabled?: boolean;
  /** PUT replaces the job, so an edit sends back the limits it does not change; absent, the service resets them. */
  timeout_minutes?: number;
  max_attempts?: number;
}

/** The apps of the tenant the jobs service drives (sorted), and the one a job without `app` runs on. */
export interface JobApps {
  apps: string[];
  default: string | null;
}

/**
 * This app's key in the jobs service's apps: its path on a tenant routed by path (lib/appBase.ts).
 * null where the app is served at the root (dev, a host-routed render): there no other app's engine
 * is reachable by path, so the page addresses its own engine only.
 */
export const ownApp: string | null = APP_BASE_PATH.slice(1) || null;

/**
 * The jobs satellite's base URL. Resolution order, as for AUTH_URL (lib/authConfig.ts):
 *   1. window.__JOBS_URL__ — written into /env.js from the JOBS_URL env (docker/app-env.sh);
 *   2. VITE_JOBS_URL — build-time override for local setups;
 *   3. http://localhost:3500 — the digita-jobs dev server.
 */
const injectedJobsUrl =
  typeof window !== 'undefined'
    ? ((window as unknown as Record<string, unknown>).__JOBS_URL__ as string | undefined)
    : undefined;

export const JOBS_URL: string = (
  injectedJobsUrl ||
  (import.meta.env.VITE_JOBS_URL as string | undefined) ||
  'http://localhost:3500'
).replace(/\/+$/, '');

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${JOBS_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: buildHeaders(init.method ?? 'GET', init.body !== undefined),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw Object.assign(new Error(body?.error ?? `jobs api: HTTP ${res.status}`), { status: res.status });
  }
  return (await res.json()) as T;
}

/** Availability gate: true only when the satellite answers its open /health. */
export async function jobsAlive(): Promise<boolean> {
  try {
    const res = await fetch(`${JOBS_URL}/health`, { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
}

export const jobsApi = {
  /** The route exists from digita-jobs 0.3.004 on; an older release answers 404 and names no app. */
  apps: () =>
    req<JobApps>('/api/v1/apps').catch((e: Error & { status?: number }): JobApps => {
      if (e.status === 404) return { apps: [], default: null };
      throw e;
    }),
  list: () => req<{ jobs: JobDef[] }>('/api/v1/jobs'),
  create: (body: JobInput) => req<{ job: JobDef }>('/api/v1/jobs', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: JobInput) =>
    req<{ job: JobDef }>(`/api/v1/jobs/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
  remove: (id: string) => req<{ deleted: boolean }>(`/api/v1/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  runNow: (id: string) =>
    req<{ run: JobRun }>(`/api/v1/jobs/${encodeURIComponent(id)}/run-now`, { method: 'POST', body: '{}' }),
  runs: (job?: string) => req<{ runs: JobRun[] }>(`/api/v1/runs${job ? `?job=${encodeURIComponent(job)}` : ''}`),
  run: (id: string) => req<{ run: JobRun }>(`/api/v1/runs/${encodeURIComponent(id)}`),
  cancel: (id: string) =>
    req<{ run: JobRun }>(`/api/v1/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' }),
};

/**
 * `path` on the engine of `app`. This app's own engine, and the one engine of a page that has no
 * app to name (`app` null), are read relative, so the client (services/api.ts) puts this app's
 * base path in front. Another app's engine is addressed at /<app>/api/v1 on the tenant host, an
 * absolute URL the client leaves alone. Whether that path reaches the engine is the deployment's
 * doing: digita-deploy routes /<app>/api for a member with a digita-app front (charts/digita-app)
 * and not for a website (charts/digita-web), where the read fails and the page shows the failure.
 * Both carry the tenant session: the catalog follows the user's rights on that app.
 */
const engineUrl = (app: string | null, path: string) =>
  app === null || app === ownApp
    ? `/api/v1${path}`
    : `${window.location.origin}/${encodeURIComponent(app)}/api/v1${path}`;

export const appEngine = {
  catalog: (app: string | null) => api.get<ApiResponse<EntitySummary[]>>(engineUrl(app, '/meta')),
  entity: (app: string | null, entity: string) =>
    api.get<ApiResponse<EntityDefinition>>(engineUrl(app, `/meta/${encodeURIComponent(entity)}`)),
  single: (app: string | null, entity: string) =>
    api.get<ApiResponse<{ _id?: string }>>(engineUrl(app, `/resource/${encodeURIComponent(entity)}/single`)),
};

/** Role gate mirroring the satellite's RBAC (digita-jobs src/auth/roles.ts hasRole): only
 *  Administrator, jobs:Admin and jobs:Viewer pass; System User, every member's role, does not. */
export function jobsRole(roles: readonly string[]): 'admin' | 'viewer' | null {
  if (roles.includes('Administrator') || roles.includes('jobs:Admin')) return 'admin';
  if (roles.includes('jobs:Viewer')) return 'viewer';
  return null;
}

/** A job-capable action carries `long_running` (the chunk protocol flag). */
export function longRunningActions(actions: ActionDefinition[] | undefined): ActionDefinition[] {
  return (actions ?? []).filter((a) => a.long_running);
}
