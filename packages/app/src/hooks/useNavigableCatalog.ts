import { useMemo } from 'react';
import { useMetaCatalog } from '@/hooks/useMeta';

/** Engine-internal/config/log doctypes that are never "navigable app entities".
 *  Mirrors the engine meta-router list (defense in depth — the client filter
 *  applies even if the engine `navigable` flag is absent). */
const INTERNAL_CORE = new Set([
  'Entity', 'Translation', 'Language', 'Role', 'Permission', 'Rule', 'View',
  'Workspace', 'ListPreference', 'File', 'DocShare', 'Log', 'Setting', 'BrandingSetting',
]);

/** The meta catalog filtered to real, navigable app entities — the source for the
 *  fallback dashboard + the command-palette nav index (never raw getAll()). */
export function useNavigableCatalog() {
  const query = useMetaCatalog();
  const navigable = useMemo(
    () =>
      (query.data ?? []).filter(
        (s) => s.navigable !== false && !s.is_log && !INTERNAL_CORE.has(s.name) && !s.is_single,
      ),
    [query.data],
  );
  return { ...query, navigable };
}
