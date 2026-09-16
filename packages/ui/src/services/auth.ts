import { api } from '@/services/api';
import { authUrl } from '@/lib/authConfig';

/**
 * Session endpoints of the tenant IdP (digita-auth). The password and 2FA steps
 * are NOT here: the IdP owns them behind its own login page (lib/authConfig.ts
 * redirects there). Identity is resolved from the engine's /boot via the
 * httpOnly access cookie, so the logout half is all that is left.
 */

/** Revoke the session server-side and clear the zone cookies. */
export function logout(): Promise<unknown> {
  return api.post<unknown>(authUrl('/api/v1/auth/logout'), {});
}
