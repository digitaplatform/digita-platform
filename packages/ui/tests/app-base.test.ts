// @vitest-environment jsdom
// The app under a base path: its own root paths go under the base, everything
// else passes unchanged.
import { describe, it, expect, vi, afterEach } from 'vitest';

async function loadWithBase(basePath: string) {
  (window as unknown as Record<string, unknown>).__APP_BASE_PATH__ = basePath;
  vi.resetModules();
  const { appUrl, APP_BASE_PATH } = await import('@/lib/appBase');
  const { safeHttpUrl } = await import('@/lib/safe-url');
  return { appUrl, APP_BASE_PATH, safeHttpUrl };
}

describe('app base path', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__APP_BASE_PATH__;
  });

  it('puts engine calls and stored engine file URLs under the base', async () => {
    const { appUrl, safeHttpUrl } = await loadWithBase('/erp');
    expect(appUrl('/api/v1/meta')).toBe('/erp/api/v1/meta');
    expect(appUrl('/plugins/index.json')).toBe('/erp/plugins/index.json');
    expect(safeHttpUrl('/api/v1/file/abc/download')).toBe('/erp/api/v1/file/abc/download');
  });

  it('leaves absolute, protocol-relative and relative URLs unchanged', async () => {
    const { appUrl, safeHttpUrl } = await loadWithBase('/erp');
    expect(appUrl('https://acme.example/auth/api/v1/auth/refresh')).toBe('https://acme.example/auth/api/v1/auth/refresh');
    expect(appUrl('//cdn.example/x.js')).toBe('//cdn.example/x.js');
    expect(appUrl('files/x.png')).toBe('files/x.png');
    expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined();
  });

  it('trims a trailing slash and serves the root without a prefix', async () => {
    expect((await loadWithBase('/erp/')).APP_BASE_PATH).toBe('/erp');
    const root = await loadWithBase('');
    expect(root.appUrl('/api/v1/meta')).toBe('/api/v1/meta');
  });
});
