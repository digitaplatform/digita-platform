// @vitest-environment jsdom
// Jobs satellite client: its injected URL, role gate mirroring the satellite
// RBAC, long_running catalog filter.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sessionCookieNames, SESSION_COOKIE, CSRF_HEADER, type ActionDefinition } from '@digitaplatform/shared';
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
    // digita-jobs grants the default role of every invited member nothing (roles.ts hasRole).
    expect(jobsRole(['System User'])).toBeNull();
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

  describe('CSRF double-submit', () => {
    const GUID = 'a1b2c3d4e5f6';
    afterEach(() => {
      vi.doUnmock('@/lib/authConfig');
      vi.unstubAllGlobals();
    });

    it("sends this unit's CSRF cookie on every mutation and none on a read", async () => {
      vi.resetModules();
      vi.doMock('@/lib/authConfig', () => ({
        AUTH_COOKIE_SUFFIX: GUID,
        authUrl: (path: string) => path,
        redirectToIdpLogin: vi.fn(),
      }));
      Object.defineProperty(document, 'cookie', {
        writable: true,
        value: `${SESSION_COOKIE.CSRF}=platform-csrf; ${sessionCookieNames(GUID).CSRF}=tenant-csrf`,
      });
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
      vi.stubGlobal('fetch', fetchMock);
      const { jobsApi } = await import('@/services/jobs');
      const body = { name: 'n', entity: 'E', doc: 'd', action: 'a' };

      await jobsApi.create(body);
      await jobsApi.update('j', body);
      await jobsApi.remove('j');
      await jobsApi.runNow('j');
      await jobsApi.cancel('r');
      await jobsApi.list();
      const headers = fetchMock.mock.calls.map(([, init]) => new Headers((init as RequestInit).headers));
      expect(headers.slice(0, 5).map((h) => h.get(CSRF_HEADER))).toEqual(Array(5).fill('tenant-csrf'));
      expect(headers[5]!.get(CSRF_HEADER)).toBeNull();
    });
  });
});
