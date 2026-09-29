import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface CardListProps<T> {
  rows: T[];
  /** Stable row identity; drives React keys and `onRowClick`. */
  getRowId: (row: T) => string;
  /** The card of this row carries `aria-current="true"`. */
  currentRowId?: string;
  onRowClick?: (rowId: string) => void;
  /** The content of one card; the list owns the card frame and its hooks. */
  renderCard: (row: T) => ReactNode;
  className?: string;
  'aria-label'?: string;
}

/**
 * The phone-width sibling of DataGrid: one card per row, each a button that opens
 * the row. Hooks: `list-group` on the list, `list-row` on every card.
 */
export function CardList<T>({ rows, getRowId, currentRowId, onRowClick, renderCard, className, 'aria-label': ariaLabel }: CardListProps<T>) {
  return (
    <ul data-ui="list-group" aria-label={ariaLabel} className={cn('space-y-3', className)}>
      {rows.map((row) => {
        const rowId = getRowId(row);
        return (
          <li key={rowId}>
            <button
              type="button"
              data-ui="list-row"
              aria-current={rowId === currentRowId ? 'true' : undefined}
              onClick={onRowClick ? () => onRowClick(rowId) : undefined}
              className="block w-full rounded-card border border-border bg-surface p-[var(--density-pad)] text-left shadow-xs transition duration-base ease-smooth active:scale-[0.99]"
            >
              {renderCard(row)}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
