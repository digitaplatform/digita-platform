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
  it('writes the choices and the first count with the Domain for a tenant routed by host, and the host alone by path', () => {
    const byHost = recordingJar();
    writeLookCookie({ design: 'fluent', mode: 'dark', density: 'compact' }, lookCookieDomain('https://auth.show.digitacloud.app'), byHost);
    expect(byHost.written).toEqual([
      `${LOOK_COOKIE_NAME}=${encodeURIComponent('design=fluent&mode=dark&density=compact&n=1')}; Path=/; Max-Age=31536000; SameSite=Lax; Domain=show.digitacloud.app; Secure`,
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

  it('reads the newest of two entries, a host-only one and a Domain one, in either order', () => {
    // A tenant that moved between routing by path and by host leaves both; the browser lists the
    // older one first, whichever variant it is.
    const older = `${LOOK_COOKIE_NAME}=${encodeURIComponent('design=minimal&mode=dark&n=4')}`;
    const newer = `${LOOK_COOKIE_NAME}=${encodeURIComponent('design=editorial&mode=light&n=5')}`;
    expect(readLookCookie(recordingJar('https:', `${older}; ${newer}`))).toEqual({ design: 'editorial', mode: 'light' });
    expect(readLookCookie(recordingJar('https:', `${newer}; ${older}`))).toEqual({ design: 'editorial', mode: 'light' });
  });

  it('counts an entry without a valid count as the oldest', () => {
    const uncounted = `${LOOK_COOKIE_NAME}=${encodeURIComponent('design=minimal')}`;
    const badCount = `${LOOK_COOKIE_NAME}=${encodeURIComponent('design=fluent&n=soon')}`;
    const counted = `${LOOK_COOKIE_NAME}=${encodeURIComponent('design=editorial&n=1')}`;
    expect(readLookCookie(recordingJar('https:', `${uncounted}; ${badCount}; ${counted}`))).toEqual({ design: 'editorial' });
  });

  it('merges a write into the newest entry and counts it one above both', () => {
    const older = `${LOOK_COOKIE_NAME}=${encodeURIComponent('design=minimal&mode=dark&n=7')}`;
    const newer = `${LOOK_COOKIE_NAME}=${encodeURIComponent('design=editorial&mode=light&n=9')}`;
    const jar = recordingJar('https:', `${newer}; ${older}`);
    writeLookCookie({ density: 'compact' }, undefined, jar);
    const written = decodeURIComponent(jar.written[0]!.split(';')[0]!.slice(LOOK_COOKIE_NAME.length + 1));
    expect(written).toBe('design=editorial&mode=light&density=compact&n=10');
    expect(readLookCookie(recordingJar('https:', `${older}; ${newer}; ${jar.written[0]!.split(';')[0]}`))).toEqual({
      design: 'editorial',
      mode: 'light',
      density: 'compact',
    });
  });

  it('writes nothing when the choices it is handed are the ones the cookie holds', () => {
    // An app start and a page load hand the stored choices over again; only a change may count.
    const stored = () => decodeURIComponent(document.cookie.split('; ').find((c) => c.startsWith(`${LOOK_COOKIE_NAME}=`))!.split('=').slice(1).join('='));
    writeLookCookie({ design: 'ios', mode: 'dark' }, undefined);
    expect(stored()).toBe('design=ios&mode=dark&n=1');
    writeLookCookie({ mode: 'dark' }, undefined);
    storeIdentityPreferences({ mode: 'dark', density: undefined, design: 'ios' }, undefined);
    storeIdentityPreferences({ mode: undefined, density: undefined, design: undefined }, undefined);
    writeLookCookie({ design: 'not a design id' }, undefined);
    expect(stored()).toBe('design=ios&mode=dark&n=1');
    writeLookCookie({ mode: 'light' }, undefined);
    expect(stored()).toBe('design=ios&mode=light&n=2');
  });

  it('reads the later of two entries with the same count, the one of the current routing', () => {
    const first = `${LOOK_COOKIE_NAME}=${encodeURIComponent('design=minimal&n=3')}`;
    const later = `${LOOK_COOKIE_NAME}=${encodeURIComponent('design=editorial&n=3')}`;
    expect(readLookCookie(recordingJar('https:', `${first}; ${later}`))).toEqual({ design: 'editorial' });
  });

  it('counts on past nine digits, so a high count does not pin the look', () => {
    const jar = recordingJar('https:', `${LOOK_COOKIE_NAME}=${encodeURIComponent('mode=dark&n=999999999')}`);
    writeLookCookie({ mode: 'light' }, undefined, jar);
    const written = jar.written[0]!.split(';')[0]!;
    expect(decodeURIComponent(written.slice(LOOK_COOKIE_NAME.length + 1))).toBe('mode=light&n=1000000000');
    const both = `${LOOK_COOKIE_NAME}=${encodeURIComponent('mode=dark&n=999999999')}; ${written}`;
    expect(readLookCookie(recordingJar('https:', both))).toEqual({ mode: 'light' });
  });

  it('skips an entry it cannot decode and reads the next one', () => {
    const broken = `${LOOK_COOKIE_NAME}=%E0%A4%A`;
    const valid = `${LOOK_COOKIE_NAME}=${encodeURIComponent('design=fluent&n=1')}`;
    expect(readLookCookie(recordingJar('https:', `${broken}; ${valid}`))).toEqual({ design: 'fluent' });
  });

  it('reads no density the runtime does not know', () => {
    const jar = recordingJar('https:', `${LOOK_COOKIE_NAME}=${encodeURIComponent('design=ios&density=huge')}`);
    expect(readLookCookie(jar)).toEqual({ design: 'ios' });
  });

  it('reads the cookie of its own name, not one whose name only ends in it', () => {
    // Both orders: a tie of two uncounted entries goes to the later one, so one order alone would
    // not tell the names apart.
    const foreign = `my-${LOOK_COOKIE_NAME}=${encodeURIComponent('design=ios')}`;
    const own = `${LOOK_COOKIE_NAME}=${encodeURIComponent('design=fluent')}`;
    expect(readLookCookie(recordingJar('https:', `${foreign}; ${own}`))).toEqual({ design: 'fluent' });
    expect(readLookCookie(recordingJar('https:', `${own}; ${foreign}`))).toEqual({ design: 'fluent' });
  });

  it('writes nothing while there is no choice to carry', () => {
    const jar = recordingJar();
    writeLookCookie({}, undefined, jar);
    expect(jar.written).toEqual([]);

    storeIdentityPreferences({ mode: undefined, density: undefined, design: undefined }, undefined);
    expect(document.cookie).not.toContain(`${LOOK_COOKIE_NAME}=`);
  });

  it("writes the server's choices after sign-in for the Domain it is given", () => {
    const written: string[] = [];
    const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!;
    vi.spyOn(Document.prototype, 'cookie', 'set').mockImplementation(function (this: Document, value: string) {
      written.push(value);
      cookie.set!.call(this, value);
    });
    storeIdentityPreferences({ mode: 'dark', density: undefined, design: undefined }, 'acme.example');
    expect(written.filter((value) => value.startsWith(`${LOOK_COOKIE_NAME}=`))).toEqual([
      expect.stringContaining('; Domain=acme.example'),
    ]);
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

  it("takes the cookie's choice over a copy this browser stored before", () => {
    // Every writer writes both, so a page on another host whose storage still holds an older pick
    // shows the change the person made in the app.
    document.cookie = `${LOOK_COOKIE_NAME}=${encodeURIComponent('mode=dark')}; Path=/`;
    localStorage.setItem('digita-app:theme-mode', 'light');
    localStorage.setItem('digita-app:density', 'compact');
    expect(bootIdentity()).toMatchObject({ mode: 'dark', density: 'compact' });
  });
});
