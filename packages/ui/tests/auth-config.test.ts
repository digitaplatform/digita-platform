import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The IdP base URL is resolved ONCE at module scope, so every case re-imports
 * the module with a fresh window/env. Runs in the default `node` environment
 * with a hand-built window — jsdom's location cannot be navigated or replaced.
 */

interface FakeWindow {
  location: { href: string; assign: (url: string) => void };
  __AUTH_URL__?: string;
  __AUTH_COOKIE_SUFFIX__?: string;
}

function stubWindow(injected?: string, href = 'https://erp.acme.example/orders'): FakeWindow {
  const win: FakeWindow = { location: { href, assign: vi.fn() } };
  if (injected !== undefined) win.__AUTH_URL__ = injected;
  vi.stubGlobal('window', win);
  return win;
}

async function loadAuthConfig() {
  vi.resetModules();
  return import('../src/lib/authConfig.ts');
}

describe('authConfig', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('takes window.__AUTH_URL__ first — the runtime channel wins over the build', async () => {
    stubWindow('https://auth.acme.example');
    vi.stubEnv('VITE_AUTH_URL', 'https://build-time.example');
    const { AUTH_URL } = await loadAuthConfig();
    expect(AUTH_URL).toBe('https://auth.acme.example');
  });

  it('strips a trailing slash so authUrl() does not build a double slash', async () => {
    stubWindow('https://auth.acme.example/');
    const { AUTH_URL, authUrl } = await loadAuthConfig();
    expect(AUTH_URL).toBe('https://auth.acme.example');
    expect(authUrl('/api/v1/auth/me')).toBe('https://auth.acme.example/api/v1/auth/me');
  });

  it('falls back to VITE_AUTH_URL when the runtime channel is empty', async () => {
    stubWindow('');
    vi.stubEnv('VITE_AUTH_URL', 'https://build-time.example');
    const { AUTH_URL } = await loadAuthConfig();
    expect(AUTH_URL).toBe('https://build-time.example');
  });

  it('falls back to the digita-auth dev server when neither is set', async () => {
    stubWindow();
    const { AUTH_URL } = await loadAuthConfig();
    expect(AUTH_URL).toBe('http://localhost:5175');
  });

  it('takes the cookie suffix from the runtime channel, and falls back to the build then to none', async () => {
    const win = stubWindow('https://auth.acme.example');
    win.__AUTH_COOKIE_SUFFIX__ = 'a1b2c3d4e5f6';
    vi.stubEnv('VITE_AUTH_COOKIE_SUFFIX', 'buildtime1234');
    expect((await loadAuthConfig()).AUTH_COOKIE_SUFFIX).toBe('a1b2c3d4e5f6');

    win.__AUTH_COOKIE_SUFFIX__ = '';
    expect((await loadAuthConfig()).AUTH_COOKIE_SUFFIX).toBe('buildtime1234');

    vi.unstubAllEnvs();
    expect((await loadAuthConfig()).AUTH_COOKIE_SUFFIX).toBe('');
  });

  it('redirectToIdpLogin sends the browser to <AUTH_URL>/login with an encoded bounce-back', async () => {
    const win = stubWindow('https://auth.acme.example');
    const { redirectToIdpLogin } = await loadAuthConfig();
    redirectToIdpLogin('https://erp.acme.example/orders?view=open');
    expect(win.location.assign).toHaveBeenCalledWith(
      'https://auth.acme.example/login?redirect=' +
        encodeURIComponent('https://erp.acme.example/orders?view=open'),
    );
  });

  it('redirectToIdpLogin defaults the bounce-back to the current URL', async () => {
    const win = stubWindow('https://auth.acme.example', 'https://erp.acme.example/invoices');
    const { redirectToIdpLogin } = await loadAuthConfig();
    redirectToIdpLogin();
    expect(win.location.assign).toHaveBeenCalledWith(
      'https://auth.acme.example/login?redirect=' +
        encodeURIComponent('https://erp.acme.example/invoices'),
    );
  });
});
