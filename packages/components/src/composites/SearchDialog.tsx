import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Input } from '../primitives/Input.js';
import { Spinner } from '../primitives/Spinner.js';
import { BaseDialog } from './BaseDialog.js';

export interface SearchDialogColumn {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
}

export interface SearchDialogProps<Row> {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Current search text (controlled). */
  query: string;
  onQueryChange: (query: string) => void;
  columns: SearchDialogColumn[];
  rows: Row[];
  getRowId: (row: Row) => string;
  /** Invoked with the chosen row; the caller closes the dialog. */
  onPick: (row: Row) => void;
  loading?: boolean;
  /** The rows answer an earlier query and the next answer is on its way: they stay on screen under
   *  a quiet busy mark, and neither Enter nor a click picks one until the answer lands. */
  stale?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
  loadingLabel?: string;
  /** Override cell rendering; defaults to the raw row value as text. */
  renderCell?: (row: Row, column: SearchDialogColumn) => ReactNode;
}

/**
 * Generic search-and-pick modal — a SearchDialog is one kind of [[BaseDialog]].
 * Data-agnostic: it renders whatever columns + rows the caller supplies and
 * reports the picked row, so the SAME component serves any Link picker
 * regardless of the target entity. Search box (autofocused) + results table with
 * ArrowUp/Down to move, Enter to pick the active row, click to pick directly;
 * Escape closes (handled by BaseDialog). It stands at the height of the screen and at a width set by
 * its column count, never by its rows, so a result set that lands, shrinks or comes back empty
 * never resizes it or moves it under the pointer.
 */
export function SearchDialog<Row>({
  open,
  onClose,
  title,
  query,
  onQueryChange,
  columns,
  rows,
  getRowId,
  onPick,
  loading,
  stale,
  searchPlaceholder,
  emptyLabel = 'No results',
  loadingLabel = 'Searching…',
  renderCell,
}: SearchDialogProps<Row>) {
  const [active, setActive] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Hover may only move the highlight AFTER a genuine pointer movement. When the
  // list re-renders under a stationary cursor (fresh results landing), the row
  // now under the pointer fires a "stray" mouseEnter — that event must NOT
  // hijack the keyboard selection and make Enter pick an unintended row.
  const pointerMoved = useRef(false);

  // The highlight tracks the RESULT SET deterministically: keyed by the row ids,
  // so it resets to the first row whenever the results actually change (a new
  // query landed) — but it does NOT snap to the top on identity-only re-renders
  // (the caller maps fresh row objects every render, same ids → same key), which
  // would otherwise fight arrow-key navigation. Resetting here (rather than on
  // the typed `query`, which changes BEFORE the debounced results arrive) closes
  // the race where the old, unfiltered rows were still on screen when active reset.
  const rowsKey = rows.map(getRowId).join('\u0000');
  useEffect(() => {
    setActive(0);
    // A fresh result set arrived: ignore any stray hover until the pointer
    // truly moves again, so Enter picks the first result, not a hovered row.
    pointerMoved.current = false;
    // The list can still stand where a person scrolled the previous rows, and setActive(0) scrolls
    // nothing when the first row was already active: start at the top, where the row Enter picks is.
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [rowsKey]);

  // Keep the highlighted row scrolled into view during arrow navigation.
  useEffect(() => {
    if (!open) return;
    bodyRef.current
      ?.querySelector(`[data-search-row="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const cellOf = (row: Row, column: SearchDialogColumn): ReactNode =>
    renderCell
      ? renderCell(row, column)
      : String((row as Record<string, unknown>)[column.key] ?? '');

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      pointerMoved.current = false; // keyboard takes over; ignore stray hover
      setActive((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      pointerMoved.current = false; // keyboard takes over; ignore stray hover
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (loading || stale) { e.preventDefault(); return; }
      const row = rows[active];
      if (row) { e.preventDefault(); onPick(row); }
    }
  };

  const alignClass = (a: SearchDialogColumn['align']) =>
    a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left';

  return (
    // Up to two columns read well at `lg`; from the third on, `xl` keeps each one wide enough to read.
    <BaseDialog open={open} onClose={onClose} title={title} size={columns.length > 2 ? 'xl' : 'lg'} height="fill">
      <div
        className="flex min-h-0 flex-1 flex-col"
        onKeyDown={onKeyDown}
        onMouseMove={() => { pointerMoved.current = true; }}
      >
        <div className="relative">
          <Input
            autoFocus
            type="text"
            role="searchbox"
            aria-label={searchPlaceholder}
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="pr-9"
          />
          {stale && (
            <Spinner className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-textMuted" />
          )}
        </div>
        <div
          ref={bodyRef}
          className="mt-3 min-h-0 flex-1 overflow-auto rounded-card border border-border"
        >
          <table aria-busy={loading || stale || undefined} className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-subtle">
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    style={c.width ? { width: c.width } : undefined}
                    className={cn('px-3 py-2 font-medium text-textMuted', alignClass(c.align))}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-6 text-center text-textMuted">
                    <span className="inline-flex items-center gap-2">
                      <Spinner /> {loadingLabel}
                    </span>
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-6 text-center text-textMuted">
                    {emptyLabel}
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((row, i) => (
                  <tr
                    key={getRowId(row)}
                    data-search-row={i}
                    aria-selected={i === active}
                    onMouseEnter={() => { if (pointerMoved.current) setActive(i); }}
                    onClick={() => { if (!loading && !stale) onPick(row); }}
                    className={cn(
                      'cursor-pointer border-t border-border',
                      i === active && 'bg-bgHover',
                    )}
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={cn(
                          'px-3 py-2 text-textMain',
                          alignClass(c.align),
                          c.align === 'right' && 'tabular-nums',
                        )}
                      >
                        {cellOf(row, c)}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </BaseDialog>
  );
}
