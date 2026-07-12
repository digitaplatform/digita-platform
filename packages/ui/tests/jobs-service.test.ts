// @vitest-environment jsdom
// Jobs satellite client: host derivation (erp.<sub>.<domain> → jobs.…),
// role gate mirroring the satellite RBAC, long_running catalog filter.
import { describe, it, expect } from 'vitest';
import type { ActionDefinition } from '@digitaplatform/shared';
import { jobsBaseUrl, jobsRole, longRunningActions } from '@/services/jobs';

describe('jobs service', () => {
  it('derives the satellite host from the app host', () => {
    expect(jobsBaseUrl('erp.simetrix.dev.digitaplatform.com')).toBe(
      'https://jobs.simetrix.dev.digitaplatform.com',
    );
    expect(jobsBaseUrl('buildproject.acme.digitaplatform.com')).toBe(
      'https://jobs.acme.digitaplatform.com',
    );
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
