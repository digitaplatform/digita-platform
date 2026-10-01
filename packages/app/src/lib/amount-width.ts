import type { FieldDefinition } from '@digitaplatform/shared';
import { useSessionStore } from '@/stores/session';
import { formatCurrency } from '@/lib/format';

type Row = Record<string, unknown>;

/** The text a cell writes for a Currency value: in the row's currency, else the default one. */
export function currencyText(
  field: FieldDefinition,
  row: Row,
  formatLocale: string | undefined,
  defaultCurrency: string | null | undefined,
) {
  const cf = field.currency_field ? String(row[field.currency_field] ?? '') : '';
  return formatCurrency(row[field.fieldname], formatLocale, cf || defaultCurrency, { precision: field.precision });
}

// A cell writes text-sm (14 px) and pads 12 px on each side. No figure, letter or separator of
// the app's fonts is wider than 0.65 of the font size, so this many pixels per character hold it.
const AMOUNT_CHAR_PX = 0.65 * 14;
const CELL_PAD_PX = 24;

/**
 * The narrowest a grid column may be to show each of its amounts whole, or undefined for a column
 * that holds no amount. An amount is the one value a person must read whole, so its column takes
 * the room of its widest amount instead of cutting it with an ellipsis like text; the grid scrolls
 * when the columns outgrow the window.
 */
export function useAmountColumnWidth(): (field: FieldDefinition, rows: Row[]) => number | undefined {
  const formatLocale = useSessionStore((s) => s.locale?.format_locale);
  const defaultCurrency = useSessionStore((s) => s.settings?.default_currency);
  return (field, rows) => {
    if (field.fieldtype !== 'Currency') return undefined;
    let longest = 0;
    for (const row of rows) {
      const value = row[field.fieldname];
      if (value == null || value === '') continue;
      longest = Math.max(longest, currencyText(field, row, formatLocale, defaultCurrency).length);
    }
    return longest > 0 ? Math.ceil(longest * AMOUNT_CHAR_PX + CELL_PAD_PX) : undefined;
  };
}
