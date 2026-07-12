import type { ReactNode } from 'react';
import type { NumberCard as NumberCardDef, ViewSectionData } from '@digitaplatform/shared';
import { useSessionStore } from '@/stores/session';
import {
  EMPTY,
  formatCurrency,
  formatNumber,
  formatPercent,
} from '@/lib/format';
import { CardShell, type CardStatus } from './CardShell';

/** Explicit opt-in token: count the rows of a list section rather than read a
 *  field off an aggregate row. Any other value_field MUST exist on the row. */
const COUNT_ROWS = '$count_rows';

interface NumberCardProps {
  card: NumberCardDef;
  icon?: ReactNode;
  status: CardStatus;
  /** Loud transport/section error (from the resolver). */
  error?: string;
  data: ViewSectionData;
  onNavigate?: (to: string) => void;
}

/** Pull the single aggregate row out of a section payload: the section is either a
 *  single object OR an array whose first row is the aggregate. */
function aggregateRow(data: ViewSectionData): Record<string, unknown> | null {
  if (Array.isArray(data)) return (data[0] as Record<string, unknown> | undefined) ?? null;
  if (data && typeof data === 'object') return data as Record<string, unknown>;
  return null;
}

function formatValue(
  raw: unknown,
  card: NumberCardDef,
  row: Record<string, unknown>,
  formatLocale: string | undefined,
  defaultCurrency: string | undefined,
): string {
  switch (card.format) {
    case 'currency': {
      const cf = card.currency_field ? String(row[card.currency_field] ?? '') : '';
      return formatCurrency(raw, formatLocale, cf || defaultCurrency);
    }
    case 'percent':
      return formatPercent(raw, formatLocale);
    case 'decimal':
      return formatNumber(raw, formatLocale, { precision: 2 });
    case 'integer':
    default:
      return formatNumber(raw, formatLocale, { precision: 0 });
  }
}

/**
 * Pure KPI card. Reads `card.value_field` from the aggregate row; the special token
 * `$count_rows` counts the section's rows. A value_field that is NAMED but ABSENT in
 * the row fails LOUD (never silently renders 0). A null/empty value renders the calm
 * em-dash. Numbers format via lib/format using the boot locale.
 */
export function NumberCard({ card, icon, status, error, data, onNavigate }: NumberCardProps) {
  const formatLocale = useSessionStore((s) => s.locale?.format_locale);
  const defaultCurrency = useSessionStore((s) => s.settings?.default_currency);

  // Non-ready states pass straight through to the shell.
  if (status !== 'ready') {
    return <CardShell label={card.label} icon={icon} width={card.width} status={status} error={error} />;
  }

  // $count_rows: an explicit opt-in to row counting (never a silent fallback).
  if (card.value_field === COUNT_ROWS) {
    const count = Array.isArray(data) ? data.length : 0;
    return (
      <CardShell label={card.label} icon={icon} width={card.width} status="ready">
        <Body
          text={formatNumber(count, formatLocale, { precision: 0 })}
          trend={undefined}
          deepLink={card.deep_link}
          onNavigate={onNavigate}
        />
      </CardShell>
    );
  }

  const row = aggregateRow(data);

  // No row at all = legitimate empty section → calm em-dash.
  if (!row) {
    return (
      <CardShell label={card.label} icon={icon} width={card.width} status="ready">
        <Body text={EMPTY} trend={undefined} deepLink={undefined} onNavigate={onNavigate} />
      </CardShell>
    );
  }

  // FAIL LOUD: value_field named but the key is absent on the row — never coerce to 0.
  if (!(card.value_field in row)) {
    return (
      <CardShell
        label={card.label}
        icon={icon}
        width={card.width}
        status="error"
        error={`aggregate row has no field '${card.value_field}'`}
      />
    );
  }

  const raw = row[card.value_field];
  const text = formatValue(raw, card, row, formatLocale, defaultCurrency ?? undefined);

  let trend: string | undefined;
  if (card.trend_field && card.trend_field in row) {
    trend = formatPercent(row[card.trend_field], formatLocale);
  }

  return (
    <CardShell label={card.label} icon={icon} width={card.width} status="ready">
      <Body text={text} trend={trend} deepLink={card.deep_link} onNavigate={onNavigate} />
    </CardShell>
  );
}

function Body({
  text,
  trend,
  deepLink,
  onNavigate,
}: {
  text: string;
  trend: string | undefined;
  deepLink?: string;
  onNavigate?: (to: string) => void;
}) {
  const number = (
    <span className="text-display tabular-nums text-textMain">{text}</span>
  );
  return (
    <div className="flex flex-1 flex-col justify-end gap-1">
      {deepLink && onNavigate ? (
        <button
          type="button"
          onClick={() => onNavigate(deepLink)}
          className="self-start rounded text-left hover:text-primary-600 dark:hover:text-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          {number}
        </button>
      ) : (
        number
      )}
      {trend && <span className="text-xs font-medium text-textMuted tabular-nums">{trend}</span>}
    </div>
  );
}
