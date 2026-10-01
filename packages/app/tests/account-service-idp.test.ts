// @vitest-environment jsdom
// The calls of the account page belong to the tenant IdP (digita-auth). The app's own host routes
// /api to the engine, which serves no /api/v1/auth routes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// This app is served under /erp (lib/appBase.ts reads it at module load).
const IDP = vi.hoisted(() => {
  (window as unknown as Record<string, unknown>).__APP_BASE_PATH__ = '/erp';
  return 'https://auth.acme.example';
});

vi.mock('@/lib/authConfig', () => ({
  AUTH_URL: IDP,
  AUTH_COOKIE_SUFFIX: '',
  authUrl: (path: string) => `${IDP}${path}`,
  redirectToIdpLogin: () => {},
}));

import { api } from '@/services/api';
import { updateProfile, changePassword, listSessions, revokeSession, revokeOtherSessions } from '@/services/account';

let calls: { method: string; url: string }[] = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url: String(url) });
    return new Response('{}');
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('the account service', () => {
  it.each([
    ['updates the profile', () => updateProfile({ full_name: 'Ada Lovelace' }), 'POST', `${IDP}/api/v1/auth/profile`],
    ['changes the password', () => changePassword({ current_password: 'old', new_password: 'new' }), 'POST', `${IDP}/api/v1/auth/password`],
    ['lists the sessions', () => listSessions(), 'GET', `${IDP}/api/v1/auth/sessions`],
    ['revokes one session', () => revokeSession('s/1'), 'POST', `${IDP}/api/v1/auth/sessions/s%2F1/revoke`],
    ['revokes the other sessions', () => revokeOtherSessions(), 'POST', `${IDP}/api/v1/auth/sessions/revoke-others`],
  ])('%s at the IdP', async (_name, call, method, url) => {
    await call();
    expect(calls).toEqual([{ method, url }]);
  });

  it('leaves an engine call on the app host, under its base path', async () => {
    await api.get('/api/v1/meta');
    expect(calls).toEqual([{ method: 'GET', url: '/erp/api/v1/meta' }]);
  });
});
