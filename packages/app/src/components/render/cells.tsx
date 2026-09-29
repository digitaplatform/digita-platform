import type { EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import { Badge, type BadgeProps } from '@digitaplatform/components';
import { useSessionStore } from '@/stores/session';
import { useI18nStore } from '@/stores/i18n';
import { resolveWorkflowField } from '@/lib/workflow-field';
import {
  EMPTY,
  formatDate,
  formatDatetime,
  formatNumber,
  formatCurrency,
  formatPercent,
  formatDuration,
} from '@/lib/format';

type Row = Record<string, unknown>;

/** Request the small thumbnail variant for engine file URLs (list/card cells).
 *  External URLs are left untouched (only our /file routes honour ?thumb=1). */
function thumbSrc(url: string): string {
  if (!/\/(public\/)?file\//.test(url)) return url;
  return url.includes('?') ? `${url}&thumb=1` : `${url}?thumb=1`;
}

/** Read-only formatted cell value, shared by the desktop table + the mobile cards.
 *  Locale/currency come from the boot session; Links prefer the denormalized title. */
export function CellValue({
  field,
  row,
  entity,
}: {
  field: FieldDefinition;
  row: Row;
  entity: string;
}) {
  const locale = useSessionStore((s) => s.locale);
  const defaultCurrency = useSessionStore((s) => s.settings?.default_currency);
  const tOption = useI18nStore((s) => s.tOption);
  const value = row[field.fieldname];

  if (field.fieldtype === 'Link') {
    const titles = row['_link_titles'] as Record<string, string> | undefined;
    const title = titles?.[field.fieldname];
    if (title) return <>{title}</>;
    return value == null || value === '' ? <span className="text-textMuted">{EMPTY}</span> : <>{String(value)}</>;
  }

  if (value == null || value === '') return <span className="text-textMuted">{EMPTY}</span>;

  switch (field.fieldtype) {
    case 'Check':
      return value === 1 || value === true ? <>✓</> : <span className="text-textMuted">{EMPTY}</span>;
    case 'Date':
      return <>{formatDate(value, locale?.format_locale)}</>;
    case 'Datetime':
      return <>{formatDatetime(value, locale?.format_locale, locale?.timezone)}</>;
    case 'Currency': {
      const cf = field.currency_field ? String(row[field.currency_field] ?? '') : '';
      return <span className="tabular-nums">{formatCurrency(value, locale?.format_locale, cf || defaultCurrency, { precision: field.precision })}</span>;
    }
    case 'Float':
      return <span className="tabular-nums">{formatNumber(value, locale?.format_locale, { precision: field.precision ?? 2 })}</span>;
    case 'Int':
      return <span className="tabular-nums">{formatNumber(value, locale?.format_locale, { precision: 0 })}</span>;
    case 'Percent':
      return <span className="tabular-nums">{formatPercent(value, locale?.format_locale, field.precision ?? 2)}</span>;
    case 'Duration':
      return <>{formatDuration(value)}</>;
    case 'Select':
      return <>{tOption(entity, field.fieldname, String(value))}</>;
    case 'JSON':
    case 'Table':
    case 'Geolocation':
      return <span className="text-textMuted">…</span>;
    case 'AttachImage':
    case 'Image':
      return (
        <img
          src={thumbSrc(String(value))}
          alt=""
          loading="lazy"
          className="h-8 w-8 rounded border border-border bg-subtle object-cover"
        />
      );
    case 'Attach': {
      const name = String(value).split('/').pop() || String(value);
      return (
        <a
          href={String(value)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-primary-600 hover:underline"
        >
          {name}
        </a>
      );
    }
    default:
      return <>{String(value)}</>;
  }
}

/** The kit tone of a state's `color`: the catalog names a hue (gray, green, red, amber,
 *  yellow, blue, indigo, teal, purple), the kit names a meaning. The identity hues take
 *  the categorical slot of the same hue in the platform palette; a hue the table does
 *  not know is shown neutral and reported in DEV, not painted from the raw word. */
const STATE_TONE: Record<string, BadgeProps['color']> = {
  gray: 'neutral',
  green: 'success',
  red: 'error',
  amber: 'warning',
  yellow: 'warning',
  blue: 'info',
  indigo: 'cat-1',
  teal: 'cat-2',
  purple: 'cat-7',
};

function stateTone(color: string | undefined): BadgeProps['color'] {
  const tone = color ? STATE_TONE[color] : undefined;
  if (color && !tone && import.meta.env.DEV) console.warn(`[StatusBadge] state color "${color}" has no kit tone — shown neutral`);
  return tone ?? 'neutral';
}

/** The workflow state of a row as the kit `Badge`, so every design reaches it through
 *  `data-ui="badge"` and `data-color`. The tone comes from the declared `states[].color`,
 *  never from the value text; rendered only for an entity that declares a workflow (see
 *  resolveWorkflowField). */
export function StatusBadge({
  meta,
  row,
  size = 'md',
}: {
  meta: EntityDefinition;
  row: Row;
  size?: BadgeProps['size'];
}) {
  const tOption = useI18nStore((s) => s.tOption);
  const wf = resolveWorkflowField(meta);
  if (!wf) return null;
  const val = row[wf];
  if (val == null || val === '') return null;
  const state = meta.states?.find((s) => s.value === val);
  return (
    <Badge variant="pill" color={stateTone(state?.color)} size={size}>
      {tOption(meta.name, wf, String(val))}
    </Badge>
  );
}
