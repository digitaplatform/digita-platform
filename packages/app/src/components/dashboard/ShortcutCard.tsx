import type { ReactNode } from 'react';
import type { ShortcutCard as ShortcutCardDef, ViewSectionData } from '@digitaplatform/shared';
import { Card } from '@digitaplatform/components';
import { formatNumber } from '@/lib/format';
import { useSessionStore } from '@/stores/session';

interface ShortcutCardProps {
  card: ShortcutCardDef;
  icon?: ReactNode;
  /** Optional resolved count section (only when card declares count_view/section). */
  countData?: ViewSectionData;
  onNavigate: (to: string) => void;
}

/** Read the count off a resolved count section: a single aggregate row's
 *  count_field, or the row count of a list section. */
function resolveCount(card: ShortcutCardDef, data: ViewSectionData | undefined): number | null {
  if (data == null) return null;
  if (card.count_field) {
    const row = Array.isArray(data) ? data[0] : (data as Record<string, unknown>);
    if (row && card.count_field in row) {
      const n = Number((row as Record<string, unknown>)[card.count_field]);
      return Number.isNaN(n) ? null : n;
    }
    return null;
  }
  return Array.isArray(data) ? data.length : null;
}

/**
 * Pure navigation tile. Links to card.to via onNavigate (kept out of the router so
 * the card stays presentation-only). An optional count is shown when the card
 * declares a count section AND a value resolves; otherwise the tile renders without
 * a number (no fabricated 0).
 */
export function ShortcutCard({ card, icon, countData, onNavigate }: ShortcutCardProps) {
  const formatLocale = useSessionStore((s) => s.locale?.format_locale);
  const count = card.count_view || card.count_section ? resolveCount(card, countData) : null;

  return (
    <Card className="p-0">
      <button
        type="button"
        onClick={() => onNavigate(card.to)}
        className="flex w-full items-start gap-3 rounded-card p-4 text-left transition-colors hover:bg-bgHover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        {icon && (
          <span className="mt-0.5 shrink-0 text-primary-600 dark:text-primary-400" aria-hidden="true">
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold text-textMain">{card.label}</span>
            {count != null && (
              <span className="shrink-0 rounded-full bg-subtle px-2 py-0.5 text-xs font-medium tabular-nums text-textMuted">
                {formatNumber(count, formatLocale, { precision: 0 })}
              </span>
            )}
          </span>
          {card.description && (
            <span className="mt-0.5 block truncate text-xs text-textMuted">{card.description}</span>
          )}
        </span>
      </button>
    </Card>
  );
}
