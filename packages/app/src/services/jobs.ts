import type { ActionDefinition } from '@digitaplatform/shared';

/**
 * Client for the per-tenant digita-jobs satellite. The UI probes /health once
 * per session — no service, no jobs UI (menu entry and route stay hidden). Auth
 * rides the tenant session cookie (verified by the satellite via JWKS).
 */

export interface JobDef {
  _id: string;
  name: string;
  entity: string;
  doc?: string;
  action: string;
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
  params?: Record<string, unknown>;
  schedule?: { cron: string } | null;
  enabled?: boolean;
}

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

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${JOBS_URL}${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `jobs api: HTTP ${res.status}`);
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

/** Role gate mirroring the satellite's RBAC (jobs:Admin / jobs:Viewer). */
export function jobsRole(roles: readonly string[]): 'admin' | 'viewer' | null {
  if (roles.includes('Administrator') || roles.includes('System User') || roles.includes('jobs:Admin'))
    return 'admin';
  if (roles.includes('jobs:Viewer')) return 'viewer';
  return null;
}

/** A job-capable action carries `long_running` (the chunk protocol flag). */
export function longRunningActions(actions: ActionDefinition[] | undefined): ActionDefinition[] {
  return (actions ?? []).filter((a) => a.long_running);
}
