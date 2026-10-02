import type { Density, ThemeMode } from './runtime.js';

/**
 * The cookie that carries a person's look, the design, the light/dark mode and the density they
 * chose in the app, to every page of their tenant: the sign-in pages, the report designer and the
 * website. Those are separate programs, and for a tenant routed by host they stand on hosts of
 * their own, where the app's browser storage cannot be read. The cookie holds the three choices and
 * no identifier, and the pages write it, never a server.
 */
export const LOOK_COOKIE_NAME = 'digita-look';

const LOOK_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** The choices the cookie carries; a choice the person never made is absent. */
export interface LookChoices {
  design?: string;
  mode?: ThemeMode;
  density?: Density;
}

/** A design id as the design registry names them, so the cookie cannot carry anything else. */
const DESIGN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A browser's cookie jar, as `document` offers it: reading lists the cookies, writing sets one. */
export interface CookieJar {
  cookie: string;
  location?: { protocol: string };
}

/** The newest `digita-look` entry the jar holds, with its change count; undefined without one. */
function readNewestEntry(source: CookieJar): { count: number; params: URLSearchParams } | undefined {
  let newest: { count: number; params: URLSearchParams } | undefined;
  for (const part of source.cookie.split(';')) {
    const entry = part.trim();
    if (!entry.startsWith(`${LOOK_COOKIE_NAME}=`)) continue;
    let params: URLSearchParams;
    try {
      params = new URLSearchParams(decodeURIComponent(entry.slice(LOOK_COOKIE_NAME.length + 1)));
    } catch {
      continue;
    }
    // An entry without a valid count counts as the oldest. On a tie the later entry wins: the
    // browser lists the entry it created first first, and a rewrite keeps that creation time, so
    // after a routing move the entry of the current routing is the later one.
    const written = params.get('n');
    const count = written && /^\d{1,15}$/.test(written) ? Number(written) : 0;
    if (!newest || count >= newest.count) newest = { count, params };
  }
  return newest;
}

/**
 * The choices the cookie holds; a value that is no valid choice is left out. A browser can hold
 * two cookies of this name: a host-only one and one for the tenant's zone, written before and
 * after the tenant moved between routing by path and by host. Both reach the page, the older one
 * first, so each write counts one up from the newest entry it sees (`n`), and the entry with the
 * highest count is read. A count, not a time, so the cookie carries no value unique to a person.
 * A page on another host does not see a host-only entry. After a move from path to host routing,
 * the site at the zone reads its older host-only entry, and a light/dark switch there merges into
 * that entry, so the older design and density come back on every host until the person picks the
 * look once in the app.
 */
export function readLookCookie(jar?: CookieJar): LookChoices {
  // A server render has no document, and no cookie of the person to read.
  const source = jar ?? (typeof document === 'undefined' ? undefined : document);
  if (!source) return {};
  const newest = readNewestEntry(source);
  if (!newest) return {};
  const { params } = newest;
  return validChoices({ design: params.get('design'), mode: params.get('mode'), density: params.get('density') });
}

/** The choices among `values` that are valid, as the reader takes them. */
function validChoices(values: { design?: unknown; mode?: unknown; density?: unknown }): LookChoices {
  const choices: LookChoices = {};
  const { design, mode, density } = values;
  if (typeof design === 'string' && DESIGN_ID.test(design)) choices.design = design;
  if (mode === 'light' || mode === 'dark' || mode === 'system') choices.mode = mode;
  if (density === 'comfortable' || density === 'compact' || density === 'spacious') choices.density = density;
  return choices;
}

/**
 * The Domain the cookie is written for, from the address of the tenant's sign-in pages. With a path
 * (`https://<zone>/auth`: a tenant routed by path, or on its own domain) every page stands on that
 * one host, so the cookie is host-only (undefined). Without one (`https://auth.<zone>`: routed by
 * host) it is the tenant's zone, the sign-in host minus its first label, which every host of the
 * tenant shares and no other tenant does. That is the rule digita-auth's postLoginRedirect uses to
 * recognize the tenant's hosts. A host of fewer than three labels, or an IP address, gets host-only.
 */
export function lookCookieDomain(signInUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(signInUrl);
  } catch {
    return undefined;
  }
  if (url.pathname.replace(/\/+$/, '') !== '') return undefined;
  const host = url.hostname.toLowerCase();
  if (/^[\d.]+$/.test(host) || host.includes(':')) return undefined;
  const labels = host.split('.');
  return labels.length >= 3 ? labels.slice(1).join('.') : undefined;
}

/**
 * Write the choices into the cookie, one count above the newest entry, keeping the choices already
 * there that `choices` does not name. Only a change is written, so the count counts changes, and an
 * app start or a page load that hands over the stored choices again writes nothing.
 */
export function writeLookCookie(choices: LookChoices, domain: string | undefined, jar: CookieJar = document): void {
  const held = readLookCookie(jar);
  // Only valid choices are merged, as the reader would take them: an invalid one neither erases a
  // held choice nor counts as a change on every load.
  const merged: LookChoices = { ...held, ...validChoices(choices) };
  if (merged.design === held.design && merged.mode === held.mode && merged.density === held.density) return;
  const params = new URLSearchParams();
  if (merged.design) params.set('design', merged.design);
  if (merged.mode) params.set('mode', merged.mode);
  if (merged.density) params.set('density', merged.density);
  params.set('n', String((readNewestEntry(jar)?.count ?? 0) + 1));
  const value = params.toString();
  const attributes = [
    'Path=/',
    `Max-Age=${LOOK_COOKIE_MAX_AGE_SECONDS}`,
    'SameSite=Lax',
    ...(domain ? [`Domain=${domain}`] : []),
    ...(jar.location?.protocol === 'https:' ? ['Secure'] : []),
  ];
  jar.cookie = `${LOOK_COOKIE_NAME}=${encodeURIComponent(value)}; ${attributes.join('; ')}`;
}
