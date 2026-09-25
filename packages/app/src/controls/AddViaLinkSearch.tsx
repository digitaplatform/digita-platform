import { useEffect, useState } from 'react';
import { SearchDialog } from '@digitaplatform/components';
import type { FieldDefinition } from '@digitaplatform/shared';
import { useMeta } from '@/hooks/useMeta';
import { useSearchLink } from '@/hooks/useSearchLink';
import { useChrome } from '@/lib/chrome-i18n';

interface AddViaLinkSearchProps {
  open: boolean;
  onClose: () => void;
  /** The child Link field whose target + search_columns drive the picker. */
  linkField: FieldDefinition;
  /** Called with the picked row id and its display text so the caller can
   *  append a new line that already shows a title instead of the raw id. */
  onPick: (id: string, display?: string) => void;
  /** Seed the dialog query when it opens (e.g. from an entry input field). */
  initialQuery?: string;
}

/**
 * Link-search modal that ADDS a grid row (line-entry style): pick from the link
 * target's search dialog and the caller appends a row with that link set. Lives in
 * its own component so its data hooks run only when an add-via-link table renders
 * it — not on every grid.
 */
export function AddViaLinkSearch({
  open,
  onClose,
  linkField,
  onPick,
  initialQuery,
}: AddViaLinkSearchProps) {
  const tc = useChrome();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(t);
  }, [query]);
  // Seed the query (from the entry input) each time the dialog opens — the
  // DEBOUNCED value too, so the FIRST result set already filters on what the
  // user typed instead of flashing the unfiltered first-N list.
  useEffect(() => {
    if (open) {
      setQuery(initialQuery ?? '');
      setDebounced(initialQuery ?? '');
    }
  }, [open, initialQuery]);

  const meta = useMeta(linkField.target);
  const columns = linkField.search_columns ?? meta.data?.search_fields ?? [];
  const results = useSearchLink({
    entity: linkField.target,
    q: debounced,
    filters: linkField.target_filters as Record<string, unknown> | undefined,
    fields: columns,
    enabled: open,
  });

  return (
    <SearchDialog
      open={open}
      onClose={onClose}
      title={tc('ui.link.searchEntity', { entity: linkField.target ?? '' })}
      query={query}
      onQueryChange={setQuery}
      columns={columns.map((key) => ({
        key,
        label: meta.data?.fields?.find((f) => f.fieldname === key)?.label ?? key,
      }))}
      rows={(results.data ?? []).map((r) => ({
        _id: r._id,
        display: r.display,
        ...(r.fields ?? {}),
      }))}
      getRowId={(r) => r._id}
      onPick={(r) => onPick(r._id, r.display)}
      loading={results.isLoading}
      searchPlaceholder={tc('ui.list.search')}
      emptyLabel={tc('ui.select.noResults')}
      loadingLabel={tc('ui.link.searching')}
    />
  );
}
