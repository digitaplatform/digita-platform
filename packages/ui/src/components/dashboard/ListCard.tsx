import type { ReactNode } from 'react';
import type { ListCard as ListCardDef, ViewSectionData } from '@digitaplatform/shared';
import { cn } from '@digitaplatform/components';
import { EMPTY } from '@/lib/format';
import { CardShell, type CardStatus } from './CardShell';

interface ListCardProps {
  card: ListCardDef;
  icon?: ReactNode;
  status: CardStatus;
  error?: string;
  data: ViewSectionData;
  onNavigate?: (to: string) => void;
}

/** How many keys to show when the card declares no columns. */
const DEFAULT_KEY_LIMIT = 4;

function pickColumns(card: ListCardDef, rows: Array<Record<string, unknown>>): string[] {
  if (card.columns && card.columns.length > 0) return card.columns;
  const first = rows[0];
  if (!first) return [];
  // Skip engine-internal keys; show the first few business keys.
  return Object.keys(first)
    .filter((k) => k !== '_link_titles')
    .slice(0, DEFAULT_KEY_LIMIT);
}

function cellText(value: unknown): string {
  if (value == null || value === '') return EMPTY;
  if (typeof value === 'object') return EMPTY;
  return String(value);
}

/**
 * Pure compact read-only table over the section rows. No field meta is available
 * here (cards are app-agnostic over arbitrary views), so values render via
 * String(value) with an em-dash for null — CellValue is intentionally NOT used.
 * Each row links via card.deep_link (with $token interpolation done at the Page,
 * passed down as onNavigate), or is non-interactive when no deep_link is set.
 */
export function ListCard({ card, icon, status, error, data, onNavigate }: ListCardProps) {
  if (status !== 'ready') {
    return <CardShell label={card.label} icon={icon} width={card.width} status={status} error={error} />;
  }

  const rows = Array.isArray(data) ? data : [];
  const limited = typeof card.limit === 'number' ? rows.slice(0, card.limit) : rows;
  const columns = pickColumns(card, limited);
  const interactive = !!card.deep_link && !!onNavigate;

  if (limited.length === 0) {
    return (
      <CardShell label={card.label} icon={icon} width={card.width ?? 2} status="ready">
        <p className="flex flex-1 items-center text-sm text-textMuted">{EMPTY}</p>
      </CardShell>
    );
  }

  return (
    <CardShell label={card.label} icon={icon} width={card.width ?? 2} status="ready">
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-textMuted">
            <tr>
              {columns.map((c) => (
                <th key={c} className="px-1 pb-2 text-xs font-medium uppercase tracking-wide">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {limited.map((row, i) => {
              const content = columns.map((c) => (
                <td key={c} className="truncate px-1 py-2 text-textMain">
                  {cellText(row[c])}
                </td>
              ));
              return (
                <tr
                  key={String(row['_id'] ?? i)}
                  className={cn(
                    'border-t border-border transition-colors',
                    interactive && 'cursor-pointer hover:bg-bgHover',
                  )}
                  onClick={interactive ? () => onNavigate!(card.deep_link!) : undefined}
                >
                  {content}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </CardShell>
  );
}
