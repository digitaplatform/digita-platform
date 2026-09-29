import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface CardListProps<T> {
  rows: T[];
  /** Stable row identity; drives React keys and `onRowClick`. */
  getRowId: (row: T) => string;
  /** The card of this row carries `aria-selected="true"`, every other card `"false"`;
   *  omitted, no card carries the attribute. */
  selectedRowId?: string;
  onRowClick?: (rowId: string) => void;
  /** The content of one card; the list owns the card frame and its hooks. */
  renderCard: (row: T) => ReactNode;
  className?: string;
  'aria-label'?: string;
}

/**
 * The phone-width sibling of DataGrid: one card per row, each an option that opens
 * the row on click, Enter or Space. A listbox, because `aria-selected` marks the
 * open record on `list-row` the way the grid marks its `table-row`, and a button
 * may not carry it. Hooks: `list-group` on the list, `list-row` on every card.
 */
export function CardList<T>({ rows, getRowId, selectedRowId, onRowClick, renderCard, className, 'aria-label': ariaLabel }: CardListProps<T>) {
  const openOnKey = (rowId: string) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onRowClick?.(rowId);
  };
  return (
    <ul role="listbox" data-ui="list-group" aria-label={ariaLabel} className={cn('space-y-3', className)}>
      {rows.map((row) => {
        const rowId = getRowId(row);
        return (
          // The list item stays as the designs' rules address the card through it.
          <li key={rowId} role="none">
            <div
              role="option"
              tabIndex={0}
              data-ui="list-row"
              aria-selected={selectedRowId === undefined ? undefined : rowId === selectedRowId}
              onClick={onRowClick ? () => onRowClick(rowId) : undefined}
              onKeyDown={onRowClick ? openOnKey(rowId) : undefined}
              className="block w-full cursor-pointer rounded-card border border-border bg-surface p-[var(--density-pad)] text-left shadow-xs transition duration-base ease-smooth focus-visible:outline-none focus-visible:shadow-focus active:scale-[0.99]"
            >
              {renderCard(row)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
