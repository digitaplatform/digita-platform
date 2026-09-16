import { SESSION_COOKIE, CSRF_HEADER } from '@digitaplatform/shared';
import { toApiError, ApiClientError } from '@/lib/errors';
import { authUrl, redirectToIdpLogin } from '@/lib/authConfig';

/**
 * HTTP client for the engine + IdP. Session tokens live in httpOnly cookies
 * (decided: XSS-safe, never in JS). Every request sends `credentials:'include'`;
 * mutations carry the CSRF double-submit header read from the readable CSRF
 * cookie. On a 401 (expired access cookie) a single shared `/auth/refresh` call
 * rotates the cookie and the request retries once. Engine calls are relative to
 * this SPA's own host; the IdP calls carry the ABSOLUTE IdP URL (lib/authConfig.ts).
 */

// Auth-FLOW endpoints where a 401 is a real failure (a spent refresh token),
// NOT an expired access cookie — never refresh-retry. Matched with `includes`,
// so the absolute IdP URLs match as well as the bare paths.
const AUTH_FLOW_PREFIXES = ['/api/v1/auth/refresh', '/api/v1/auth/logout'];
function isAuthFlowUrl(url: string): boolean {
  return AUTH_FLOW_PREFIXES.some((p) => url.includes(p));
}

type QueryParams = Record<string, string | number | boolean | undefined | null>;

function buildQueryString(params?: QueryParams): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

function readCookie(name: string): string | null {
  const escaped = name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1');
  const match = document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
  const raw = match?.[1];
  return raw === undefined ? null : decodeURIComponent(raw);
}

function buildHeaders(method: string, hasBody: boolean): HeadersInit {
  const headers: Record<string, string> = {};
  // Only declare a JSON body when one is actually sent. A bodyless request
  // (e.g. DELETE, or a GET) that still advertised Content-Type: application/json
  // made the engine try to JSON-parse an empty body and 500. Attach the
  // content-type only alongside a real serialized body.
  if (hasBody) headers['Content-Type'] = 'application/json';
  const lang = document.documentElement.lang;
  if (lang) headers['Accept-Language'] = lang;
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = readCookie(SESSION_COOKIE.CSRF);
    if (csrf) headers[CSRF_HEADER] = csrf;
  }
  return headers;
}

// ── Refresh rotation ────────────────────────────────────────────────────
// A single in-flight refresh is shared by all callers that 401 concurrently,
// so an expired access cookie triggers exactly one /auth/refresh round-trip.
let refreshInFlight: Promise<boolean> | null = null;

/**
 * Ask the IdP to rotate the session via the httpOnly refresh cookie. Sends `{}` —
 * the refresh token is the cookie, but the json body-parser rejects an empty body. Shared single-flight. Returns false (without
 * side effects) when the IdP rejects it. Short-circuits when there is no session
 * at all (no readable CSRF cookie) — a fresh/logged-out visitor has nothing to
 * refresh, so we avoid a guaranteed 400 on every login-screen load.
 */
export async function attemptRefresh(): Promise<boolean> {
  if (!readCookie(SESSION_COOKIE.CSRF)) return false;
  if (!refreshInFlight) {
    refreshInFlight = fetch(authUrl('/api/v1/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
      headers: buildHeaders('POST', true),
      // Empty body under Content-Type: application/json is rejected by the
      // backend parser BEFORE the refresh cookie is read — send an empty object.
      body: '{}',
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/** The session is gone for good — hand the browser to the IdP login. On /login
 *  the page itself already redirects, carrying the route the user wanted; a
 *  second jump from here would replace that target with /login. */
function redirectToLogin(): void {
  if (window.location.pathname !== '/login') redirectToIdpLogin();
}

interface RequestOptions {
  params?: QueryParams;
  body?: unknown;
  /** Per-request headers merged over the defaults (e.g. If-Match for optimistic concurrency). */
  headers?: Record<string, string>;
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(method: string, url: string, opts: RequestOptions = {}): Promise<T> {
  const exec = (): Promise<Response> =>
    fetch(`${url}${buildQueryString(opts.params)}`, {
      method,
      credentials: 'include',
      headers: { ...buildHeaders(method, opts.body !== undefined), ...(opts.headers ?? {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

  let response = await exec();

  if (response.status === 401 && !isAuthFlowUrl(url)) {
    const refreshed = await attemptRefresh();
    if (refreshed) response = await exec();
    if (response.status === 401) {
      redirectToLogin();
      throw new ApiClientError('Unauthorized', 401);
    }
  }

  const body = await parseBody(response);
  if (!response.ok) throw toApiError(response.status, body);
  return body as T;
}

export const api = {
  get<T>(url: string, params?: QueryParams): Promise<T> {
    return request<T>('GET', url, { params });
  },
  post<T>(url: string, body?: unknown): Promise<T> {
    return request<T>('POST', url, { body });
  },
  put<T>(url: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return request<T>('PUT', url, { body, headers });
  },
  patch<T>(url: string, body?: unknown): Promise<T> {
    return request<T>('PATCH', url, { body });
  },
  del<T>(url: string): Promise<T> {
    return request<T>('DELETE', url);
  },
  /** Multipart POST (file upload). Sets NO Content-Type so the browser writes the
   *  boundary; keeps credentials + CSRF + Accept-Language + the single-flight 401
   *  refresh-retry. */
  async upload<T>(url: string, form: FormData): Promise<T> {
    const headers: Record<string, string> = {};
    const lang = document.documentElement.lang;
    if (lang) headers['Accept-Language'] = lang;
    const csrf = readCookie(SESSION_COOKIE.CSRF);
    if (csrf) headers[CSRF_HEADER] = csrf;

    const exec = (): Promise<Response> =>
      fetch(url, { method: 'POST', credentials: 'include', headers, body: form });

    let response = await exec();
    if (response.status === 401 && !isAuthFlowUrl(url)) {
      const refreshed = await attemptRefresh();
      if (refreshed) response = await exec();
      if (response.status === 401) {
        redirectToLogin();
        throw new ApiClientError('Unauthorized', 401);
      }
    }
    const body = await parseBody(response);
    if (!response.ok) throw toApiError(response.status, body);
    return body as T;
  },
};
