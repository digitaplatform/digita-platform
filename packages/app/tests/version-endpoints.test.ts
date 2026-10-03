import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { versionEndpoints } from '../src/lib/version-endpoints.ts';

describe('versionEndpoints', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('keeps configured endpoints first and deduplicates legacy aliases', () => {
    vi.stubGlobal('window', {
      __VERSION_ENDPOINTS__: [
        'https://app.acme.example/health',
        'https://auth.acme.example/health',
        'https://app.acme.example/health',
      ].join(','),
      __AUTH_URL__: 'https://auth.acme.example///',
      __JOBS_URL__: 'https://jobs.acme.example/',
      __REPORT_URL__: 'https://report.acme.example//',
    });

    expect(versionEndpoints()).toEqual([
      'https://app.acme.example/health',
      'https://auth.acme.example/health',
      'https://auth.acme.example/health/frontend',
      'https://jobs.acme.example/health',
      'https://report.acme.example/health',
      'https://report.acme.example/health/frontend',
    ]);
  });

  it('uses configured addresses verbatim and omits empty entries', () => {
    vi.stubGlobal('window', {
      __VERSION_ENDPOINTS__: ',https://app.acme.example/health,,',
    });
    expect(versionEndpoints()).toEqual(['https://app.acme.example/health']);
  });

  it('does not guess addresses for absent or invalid runtime values', () => {
    vi.stubGlobal('window', {});
    expect(versionEndpoints()).toEqual([]);

    for (const value of [undefined, '', null, false, 42, {}, []]) {
      vi.stubGlobal('window', {
        __VERSION_ENDPOINTS__: value,
        __AUTH_URL__: value,
        __JOBS_URL__: value,
        __REPORT_URL__: value,
      });
      expect(versionEndpoints()).toEqual([]);
    }
  });

  it('returns no addresses without window during SSR', () => {
    vi.stubGlobal('window', undefined);
    expect(versionEndpoints()).toEqual([]);
  });
});
