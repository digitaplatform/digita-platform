// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SESSION_COOKIE } from '@digitaplatform/shared';

/**
 * The api client against the tenant IdP: the session endpoints are ABSOLUTE
 * (this SPA's own host serves no auth routes — it routes /api to the engine),
 * and a session that cannot be refreshed ends at the IdP login, not at the
 * SPA's own /login (which has no form to show).
 */

const IDP = 'https://auth.acme.example';
const redirectToIdpLogin = vi.fn();
vi.mock('@/lib/authConfig', () => ({
  AUTH_URL: IDP,
  authUrl: (path: string) => `${IDP}${path}`,
  redirectToIdpLogin: (...args: unknown[]) => redirectToIdpLogin(...args),
}));

describe('api client — IdP session handling', () => {
  beforeEach(() => {
    // a readable CSRF cookie: without one attemptRefresh short-circuits
    Object.defineProperty(document, 'cookie', {
      writable: true,
      value: `${SESSION_COOKIE.CSRF}=csrf-123`,
    });
    redirectToIdpLogin.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('refreshes at the absolute IdP URL, not on this SPA host', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { attemptRefresh } = await import('../src/services/api.ts');
    await attemptRefresh();
    expect(fetchMock.mock.calls[0]![0]).toBe(`${IDP}/api/v1/auth/refresh`);
  });

  it('sends the browser to the IdP login when the 401 survives a refresh', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('/auth/refresh')
        ? ({ ok: false } as Response)
        : ({ status: 401, ok: false, text: async () => '' } as unknown as Response),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('../src/services/api.ts');
    await expect(api.get('/api/v1/entities')).rejects.toThrow('Unauthorized');
    expect(redirectToIdpLogin).toHaveBeenCalled();
    // the engine call, one refresh attempt — and no second engine call
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never refresh-retries an auth-flow call, absolute IdP URL included', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ status: 401, ok: false, text: async () => '' } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('../src/services/api.ts');
    await expect(api.post(`${IDP}/api/v1/auth/logout`, {})).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(redirectToIdpLogin).not.toHaveBeenCalled();
  });
});
