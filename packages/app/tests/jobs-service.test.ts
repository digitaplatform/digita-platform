// @vitest-environment jsdom
// Jobs satellite client: its injected URL, role gate mirroring the satellite
// RBAC, long_running catalog filter.
import { describe, it, expect, vi } from 'vitest';
import type { ActionDefinition } from '@digitaplatform/shared';
import { jobsRole, longRunningActions } from '@/services/jobs';

describe('jobs service', () => {
  it('reads the satellite URL the container injects, without a trailing slash', async () => {
    (window as unknown as Record<string, unknown>).__JOBS_URL__ = 'https://acme.example.com/jobs/';
    vi.resetModules();
    const { JOBS_URL } = await import('@/services/jobs');
    expect(JOBS_URL).toBe('https://acme.example.com/jobs');
    delete (window as unknown as Record<string, unknown>).__JOBS_URL__;
  });

  it('gates roles like the satellite (Admin > Viewer > none)', () => {
    expect(jobsRole(['Administrator'])).toBe('admin');
    expect(jobsRole(['jobs:Admin', 'Editor'])).toBe('admin');
    expect(jobsRole(['jobs:Viewer'])).toBe('viewer');
    expect(jobsRole(['Editor'])).toBeNull();
    expect(jobsRole([])).toBeNull();
  });

  it('filters the catalog to long_running actions only', () => {
    const actions = [
      { label: 'A', action: 'a', long_running: true },
      { label: 'B', action: 'b' },
    ] as ActionDefinition[];
    expect(longRunningActions(actions).map((a) => a.action)).toEqual(['a']);
    expect(longRunningActions(undefined)).toEqual([]);
  });
});
