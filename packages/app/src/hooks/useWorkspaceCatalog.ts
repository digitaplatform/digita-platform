import { useMemo } from 'react';
import type { WorkspaceDoc } from '@digitaplatform/shared';
import { useList } from '@/hooks/useList';
import { useSessionStore } from '@/stores/session';

/**
 * Enabled workspaces (priority-asc) the user may SEE — same role logic the engine
 * boot resolver uses (consistency). Empty/absent roles = all; malformed roles =
 * visible-to-none + dev log. Workspace defs are non-secret (the card DATA is the
 * View-engine-gated boundary), so visibility is client-filtered.
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
