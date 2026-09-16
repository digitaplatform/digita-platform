// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sessionCookieNames, SESSION_COOKIE, CSRF_HEADER } from '@digitaplatform/shared';

/**
 * The page reads the CSRF cookie by ITS unit's name. A browser signed in at the
 * platform IdP as well carries the bare `digita_csrf` to this tenant host too,
 * and echoing that one would fail the tenant's double-submit check.
 */

const GUID = 'a1b2c3d4e5f6';
const IDP = 'https://auth.acme.example';

function mockAuthConfig(suffix: string) {
  vi.doMock('@/lib/authConfig', () => ({
    AUTH_URL: IDP,
    AUTH_COOKIE_SUFFIX: suffix,
    authUrl: (path: string) => `${IDP}${path}`,
    redirectToIdpLogin: vi.fn(),
  }));
}

async function loadApi(suffix: string) {
  vi.resetModules();
  mockAuthConfig(suffix);
  return import('../src/services/api.ts');
}

function setCookies(value: string) {
  Object.defineProperty(document, 'cookie', { writable: true, value });
}

describe('the api client reads the CSRF cookie of its own unit', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.doUnmock('@/lib/authConfig');
    vi.restoreAllMocks();
  });

  it('echoes the suffixed cookie, not the platform IdP cookie of the same zone', async () => {
    setCookies(`${SESSION_COOKIE.CSRF}=platform-csrf; ${sessionCookieNames(GUID).CSRF}=tenant-csrf`);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { attemptRefresh } = await loadApi(GUID);
    await attemptRefresh();
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Record<string, string>)[CSRF_HEADER]).toBe('tenant-csrf');
  });

  it('has no session when only the platform IdP cookie is present — refresh short-circuits', async () => {
    setCookies(`${SESSION_COOKIE.CSRF}=platform-csrf`);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { attemptRefresh } = await loadApi(GUID);
    expect(await attemptRefresh()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the bare cookie when this unit carries no suffix', async () => {
    setCookies(`${SESSION_COOKIE.CSRF}=platform-csrf`);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { attemptRefresh } = await loadApi('');
    await attemptRefresh();
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Record<string, string>)[CSRF_HEADER]).toBe('platform-csrf');
  });
});
