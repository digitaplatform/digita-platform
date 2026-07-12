import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  updateProfile,
  changePassword,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  type UpdateProfileRequest,
  type ChangePasswordRequest,
  type SessionSummary,
} from '@/services/account';
import { qk } from '@/lib/query-keys';
import { useSessionStore } from '@/stores/session';

/** Self-service account hooks. The auth endpoints return BARE payloads → no unwrap
 *  (mirrors services/auth.ts); errors surface via the thrown ApiClientError. */

export function useSessions() {
  return useQuery<SessionSummary[]>({
    queryKey: qk.sessions(),
    staleTime: 30_000,
    queryFn: () => listSessions(),
  });
}

export function useProfileUpdate() {
  const bootstrap = useSessionStore((s) => s.bootstrap);
  return useMutation({
    mutationFn: (body: UpdateProfileRequest) => updateProfile(body),
    // /boot.user carries name/language → re-bootstrap to refresh the session identity.
    onSuccess: () => {
      void bootstrap();
    },
  });
}

export function usePasswordChange() {
  return useMutation({ mutationFn: (body: ChangePasswordRequest) => changePassword(body) });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sid: string) => revokeSession(sid),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.sessions() }),
  });
}

export function useRevokeOtherSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => revokeOtherSessions(),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.sessions() }),
  });
}
