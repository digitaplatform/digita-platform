import { useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
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

const OPTION = '[role="option"]';

/**
 * The phone-width sibling of DataGrid: one card per row, each an option that opens
 * the row on click, Enter or Space. A listbox, because `aria-selected` marks the
 * open record on `list-row` the way the grid marks its `table-row`, and a button
 * may not carry it. The list is one tab stop: the arrow keys, Home and End move
 * the stop between the cards, so Tab leaves the list in one step however long it
 * is. Hooks: `list-group` on the list, `list-row` on every card.
 */
export function CardList<T>({ rows, getRowId, selectedRowId, onRowClick, renderCard, className, 'aria-label': ariaLabel }: CardListProps<T>) {
  const [stop, setStop] = useState(0);
  // The rows may shrink under the stop (a filter, a page change): the stop follows.
  const stopIndex = Math.min(stop, rows.length - 1);

  const cardOf = (e: FocusEvent<HTMLElement> | KeyboardEvent<HTMLElement>) =>
    e.target instanceof HTMLElement ? e.target.closest<HTMLElement>(OPTION) : null;

  // Focus landing anywhere in a card (a click, a control inside it) makes that card
  // the stop, so the arrow keys continue from where the operator is.
  const onFocus = (e: FocusEvent<HTMLUListElement>) => {
    const card = cardOf(e);
    if (card) setStop(Number(card.dataset['index']));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    // A control inside a card keeps its own keys.
    if (cardOf(e) !== e.target) return;
    const cards = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(OPTION));
    const i = cards.indexOf(e.target as HTMLElement);
    let next: number;
    switch (e.key) {
      case 'ArrowDown': next = Math.min(i + 1, cards.length - 1); break;
      case 'ArrowUp': next = Math.max(i - 1, 0); break;
      case 'Home': next = 0; break;
      case 'End': next = cards.length - 1; break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        onRowClick?.(getRowId(rows[i]!));
        return;
      default:
        return;
    }
    e.preventDefault();
    setStop(next);
    cards[next]?.focus();
  };

  return (
    <ul
      role="listbox"
      data-ui="list-group"
      aria-label={ariaLabel}
      className={cn('space-y-3', className)}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
    >
      {rows.map((row, index) => {
        const rowId = getRowId(row);
        return (
          // The list item stays as the designs' rules address the card through it.
          <li key={rowId} role="none">
            <div
              role="option"
              tabIndex={index === stopIndex ? 0 : -1}
              data-index={index}
              data-ui="list-row"
              aria-selected={selectedRowId === undefined ? undefined : rowId === selectedRowId}
              onClick={onRowClick ? () => onRowClick(rowId) : undefined}
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
