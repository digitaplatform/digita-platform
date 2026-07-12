import { api } from '@/services/api';
import type { LoginRequest, LoginResponse, VerifyTwoFactorLoginRequest } from '@digitaplatform/shared';

const AUTH = '/api/v1/auth';

/**
 * Password step. On success the IdP sets httpOnly session cookies and returns
 * `status: 'authenticated'`; if 2FA is enabled it returns
 * `status: 'two_factor_required'` with a single-use `pending_token` (NOT a
 * cookie — passed back to the verify step). Any token fields in the body are
 * ignored — the session lives in the cookies.
 */
export function login(body: LoginRequest): Promise<LoginResponse> {
  return api.post<LoginResponse>(`${AUTH}/login`, body);
}

/** Second step: exchange the pending token + TOTP/recovery code for a session. */
export function verifyTwoFactorLogin(body: VerifyTwoFactorLoginRequest): Promise<LoginResponse> {
  return api.post<LoginResponse>(`${AUTH}/2fa/verify-login`, body);
}

/** Revoke the session server-side and clear the cookies. */
export function logout(): Promise<unknown> {
  return api.post<unknown>(`${AUTH}/logout`, {});
}
