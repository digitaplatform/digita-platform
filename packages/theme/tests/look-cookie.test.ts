// @vitest-environment jsdom
// A person's look travels to the tenant's pages on other hosts in the cookie digita-look: the app
// writes it with every choice, for the host alone when the tenant is routed by path and for the
// tenant's zone when it is routed by host. A page without its own stored choice boots from it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  bootIdentity,
  lookCookieDomain,
  readLookCookie,
  rememberIdentityChoices,
  storeIdentityPreferences,
  writeLookCookie,
  DESIGN_STORAGE_KEY,
  LOOK_COOKIE_NAME,
  type CookieJar,
} from '../src/index.js';

/** A cookie jar that records what is written, as a browser at `protocol` would receive it. */
function recordingJar(protocol = 'https:', initial = ''): CookieJar & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    location: { protocol },
    get cookie() {
      return initial;
    },
    set cookie(value: string) {
      written.push(value);
    },
  };
}

function clearCookie() {
  document.cookie = `${LOOK_COOKIE_NAME}=; Path=/; Max-Age=0`;
}

beforeEach(() => {
  localStorage.clear();
  clearCookie();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Domain of the look cookie', () => {
  it('is the host alone when the sign-in pages stand under a path', () => {
    expect(lookCookieDomain('https://show.digitacloud.app/auth')).toBeUndefined();
    expect(lookCookieDomain('https://show.example.ch/auth/')).toBeUndefined();
  });

  it("is the tenant's zone when the sign-in pages stand on a host of their own", () => {
    expect(lookCookieDomain('https://auth.show.digitacloud.app')).toBe('show.digitacloud.app');
    expect(lookCookieDomain('https://auth.acme.dev.digitacloud.app/')).toBe('acme.dev.digitacloud.app');
  });

  it('is the host alone for a local address, an IP address and a bare domain', () => {
    expect(lookCookieDomain('http://localhost:5175')).toBeUndefined();
    expect(lookCookieDomain('http://127.0.0.1:5175')).toBeUndefined();
    expect(lookCookieDomain('https://auth.example')).toBeUndefined();
    expect(lookCookieDomain('not an address')).toBeUndefined();
  });
});

describe('writing the look cookie', () => {
  it('writes the choices with the Domain for a tenant routed by host, and the host alone by path', () => {
    const byHost = recordingJar();
    writeLookCookie({ design: 'fluent', mode: 'dark', density: 'compact' }, lookCookieDomain('https://auth.show.digitacloud.app'), byHost);
    expect(byHost.written).toEqual([
      `${LOOK_COOKIE_NAME}=${encodeURIComponent('design=fluent&mode=dark&density=compact')}; Path=/; Max-Age=31536000; SameSite=Lax; Domain=show.digitacloud.app; Secure`,
    ]);

    const byPath = recordingJar('http:');
    writeLookCookie({ design: 'fluent' }, lookCookieDomain('https://show.digitacloud.app/auth'), byPath);
    expect(byPath.written[0]).not.toContain('Domain=');
    expect(byPath.written[0]).not.toContain('Secure');
  });

  it('keeps the choices already in the cookie that a write does not name', () => {
    const jar = recordingJar('https:', `other=1; ${LOOK_COOKIE_NAME}=${encodeURIComponent('design=ios&mode=dark')}`);
    writeLookCookie({ density: 'spacious' }, undefined, jar);
    expect(jar.written[0]).toContain(encodeURIComponent('design=ios&mode=dark&density=spacious'));
  });

  it('reads only valid choices back', () => {
    const jar = recordingJar('https:', `${LOOK_COOKIE_NAME}=${encodeURIComponent('design=../x&mode=purple&density=compact')}`);
    expect(readLookCookie(jar)).toEqual({ density: 'compact' });
  });

  it("is written with every choice the app keeps, and the server's choices after sign-in", () => {
    rememberIdentityChoices({ design: 'material' }, undefined);
    expect(readLookCookie()).toEqual({ design: 'material' });
    expect(localStorage.getItem(DESIGN_STORAGE_KEY)).toBe('material');

    storeIdentityPreferences({ mode: 'dark', density: 'bogus', design: undefined }, undefined);
    expect(readLookCookie()).toEqual({ design: 'material', mode: 'dark' });
  });
});

describe('booting from the look cookie', () => {
  it('applies the choices of the cookie on a page that stored none of its own', () => {
    document.cookie = `${LOOK_COOKIE_NAME}=${encodeURIComponent('design=editorial&mode=dark&density=spacious')}; Path=/`;
    const booted = bootIdentity();
    expect(booted).toMatchObject({ design: 'editorial', mode: 'dark', density: 'spacious' });
    expect(document.documentElement.getAttribute('data-density')).toBe('spacious');
  });

  it("keeps this browser's own stored choice over the cookie", () => {
    document.cookie = `${LOOK_COOKIE_NAME}=${encodeURIComponent('mode=dark&density=spacious')}; Path=/`;
    localStorage.setItem('digita-app:theme-mode', 'light');
    expect(bootIdentity()).toMatchObject({ mode: 'light', density: 'spacious' });
  });
});
