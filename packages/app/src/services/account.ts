import { api } from '@/services/api';
import type { SessionUser } from '@/types';

/**
 * Self-service account endpoints on the digita-auth IdP. CRITICAL: these routes
 * return BARE payloads (no ApiResponse envelope) — do NOT wrap in ApiResponse /
 * unwrap (that reads res.success → undefined → throws on every success). Mirrors
 * services/auth.ts. Errors flow via the thrown ApiClientError on non-2xx.
 *
 * MOVE to @digitaplatform/shared auth-contract.ts (Phase-3 contract dep) — declared here
 * locally until the self-service DTOs land in the shared contract.
 */
export interface UpdateProfileRequest {
  full_name?: string;
  language?: string;
}
export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}
/** Matches digita-auth's `GET /auth/sessions` wire shape verbatim (session-service
 *  listUserSessions): sessionId + snake_case fields. */
export interface SessionSummary {
  sessionId: string;
  /** Wire `status` can be '' — UI treats anything ≠ 'Active' as inactive. */
  status: string;
  ip_address?: string;
  user_agent?: string;
  created_at?: string;
  expires_at?: string;
}

const AUTH = '/api/v1/auth';

export const updateProfile = (body: UpdateProfileRequest) =>
  api.post<SessionUser>(`${AUTH}/profile`, body);

export const changePassword = (body: ChangePasswordRequest) =>
  api.post<{ ok: true }>(`${AUTH}/password`, body);

export const listSessions = () => api.get<SessionSummary[]>(`${AUTH}/sessions`);

export const revokeSession = (sid: string) =>
  api.post<{ ok: true }>(`${AUTH}/sessions/${encodeURIComponent(sid)}/revoke`, {});

export const revokeOtherSessions = () =>
  api.post<{ revoked: number }>(`${AUTH}/sessions/revoke-others`, {});
