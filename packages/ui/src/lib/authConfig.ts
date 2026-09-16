/**
 * The tenant IdP (digita-auth) base URL. The operator UI consumes the IdP over
 * its PUBLIC URL — a full-page redirect to its login, cross-origin fetch of
 * refresh/logout — never on its own origin: this SPA's host routes /api to the
 * ENGINE, which has no auth routes.
 *
 * Resolution order:
 *   1. window.__AUTH_URL__ — runtime channel: the nginx entrypoint writes
 *      /env.js from the AUTH_URL env (docker/ui-env.sh), so ONE image serves
 *      every tenant and stage.
 *   2. VITE_AUTH_URL — build-time override for local setups.
 *   3. http://localhost:5175 — the digita-auth frontend dev server (it serves
 *      the login UI and proxies /api/v1/* to the IdP backend :3100).
 */
const injected =
  typeof window !== 'undefined'
    ? ((window as unknown as Record<string, unknown>).__AUTH_URL__ as string | undefined)
    : undefined;

export const AUTH_URL: string = (
  injected ||
  (import.meta.env.VITE_AUTH_URL as string | undefined) ||
  'http://localhost:5175'
).replace(/\/+$/, '');

/**
 * The suffix the tenant IdP puts on its session cookie names (the tenant guid;
 * empty on the platform, which keeps the bare names). Same three-step
 * resolution and the same runtime channel as AUTH_URL, so ONE image serves
 * every tenant. Without it the page would read the platform IdP's CSRF cookie,
 * which the browser sends to every host of the zone under the bare name.
 */
const injectedSuffix =
  typeof window !== 'undefined'
    ? ((window as unknown as Record<string, unknown>).__AUTH_COOKIE_SUFFIX__ as string | undefined)
    : undefined;

export const AUTH_COOKIE_SUFFIX: string =
  injectedSuffix || (import.meta.env.VITE_AUTH_COOKIE_SUFFIX as string | undefined) || '';

/**
 * Absolute IdP endpoint URL. Auth calls MUST be absolute — the session cookies
 * are scoped to the tenant zone, so `credentials: 'include'` carries them to
 * the IdP host.
 */
export function authUrl(path: string): string {
  return `${AUTH_URL}${path}`;
}

/**
 * Full-page redirect to the IdP login (the IdP owns the password and 2FA
 * halves — there is no local login form). After a successful login the IdP
 * bounces back via ?redirect= (it honors only same-zone https targets).
 * `redirectTo` defaults to the current URL so the user resumes where the
 * session expired.
 */
export function redirectToIdpLogin(redirectTo?: string): void {
  if (typeof window === 'undefined') return;
  const back = encodeURIComponent(redirectTo ?? window.location.href);
  window.location.assign(`${AUTH_URL}/login?redirect=${back}`);
}
