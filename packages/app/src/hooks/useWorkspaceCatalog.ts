import { useMemo } from 'react';
import type { WorkspaceDoc } from '@digitaplatform/shared';
import { useList } from '@/hooks/useList';
import { useSessionStore } from '@/stores/session';

/**
 * Enabled workspaces (priority-asc) the user may SEE: those whose roles name one of the
 * user's roles, and those with empty/absent roles, which the engine lists only to a user a
 * permission row lets read workspaces, never to a user who holds only roles of the app. The
 * engine hands an Administrator every row, so the role match is repeated here; malformed
 * roles = visible-to-none + dev log.
 */
export function useWorkspaceCatalog() {
  const user = useSessionStore((s) => s.user);
  const query = useList<WorkspaceDoc>('Workspace', {
    filters: [['enabled', '=', true]],
    order_by: 'priority asc',
    page_size: 100,
  });
  const roles = useMemo(() => new Set(user?.roles ?? []), [user]);
  const visible = useMemo(
    () =>
      (query.data?.rows ?? []).filter((w) => {
        const r = w.roles;
        if (r == null) return true;
        if (!Array.isArray(r)) {
          if (import.meta.env.DEV) console.warn(`[workspace] malformed roles on "${w._id}" — hidden`);
          return false;
        }
        return r.length === 0 || r.some((x) => roles.has(x));
      }),
    [query.data, roles],
  );
  return { ...query, visible };
}
