import type { EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import { cn, type BadgeProps } from '@digitaplatform/components';
import { useSessionStore } from '@/stores/session';
import { useI18nStore } from '@/stores/i18n';
import { useChrome } from '@/lib/chrome-i18n';
import { resolveWorkflowField } from '@/lib/workflow-field';
import { currencyText } from '@/lib/amount-width';
import {
  EMPTY,
  formatDate,
  formatDatetime,
  formatNumber,
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

/** The picture of a record: the value of the field its entity names as `image_field`, or null
 *  when the entity names no field or the record has no picture. */
export function recordImageUrl(meta: EntityDefinition, row: Row): string | null {
  const value = meta.image_field ? row[meta.image_field] : undefined;
  return typeof value === 'string' && value ? value : null;
}

/** The record's picture beside its title in a list row, a card and the record header. Nothing
 *  without one, so such a record keeps its plain title. */
export function RecordImage({
  meta,
  row,
  className,
}: {
  meta: EntityDefinition;
  row: Row;
  className: string;
}) {
  const url = recordImageUrl(meta, row);
  if (!url) return null;
  return (
    <img
      src={thumbSrc(url)}
      alt=""
      loading="lazy"
      data-component="record-image"
      className={cn('shrink-0 rounded border border-border bg-subtle object-cover', className)}
    />
  );
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
  const tc = useChrome();
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
    case 'Currency':
      return <span className="tabular-nums">{currencyText(field, row, locale?.format_locale, defaultCurrency)}</span>;
    case 'Float':
      return <span className="tabular-nums">{formatNumber(value, locale?.format_locale, { precision: field.precision ?? 2 })}</span>;
    case 'Int':
      return <span className="tabular-nums">{formatNumber(value, locale?.format_locale, { precision: 0 })}</span>;
    case 'Percent':
      return <span className="tabular-nums">{formatPercent(value, locale?.format_locale, field.precision ?? 2)}</span>;
    case 'Duration':
      return <>{formatDuration(value, field)}</>;
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
    case 'Signature':
      // A signature is stored as a PNG data URL, which would fill the cell as text.
      return (
        <img src={String(value)} alt={tc('ui.signature.alt')} className="h-7 w-auto rounded border border-border bg-paper" />
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

/** The kit tone of a state's `color`: the catalog names a hue, the kit names a meaning.
 *  The cool hues beside blue (indigo, teal, cyan, purple) carry no meaning of their own
 *  in the kit and share the informational tone; the categorical palette is not an
 *  option, because every design fills it with its own hues for belonging, not status
 *  (`Design.categorical`). A hue the table does not know is shown neutral and reported
 *  in DEV, not painted from the raw word. */
const STATE_TONE: Record<string, BadgeProps['color']> = {
  gray: 'neutral',
  green: 'success',
  red: 'error',
  amber: 'warning',
  yellow: 'warning',
  blue: 'info',
  indigo: 'info',
  teal: 'info',
  cyan: 'info',
  purple: 'info',
};

function stateTone(color: string | undefined): BadgeProps['color'] {
  const tone = color ? STATE_TONE[color] : undefined;
  if (color && !tone && import.meta.env.DEV) console.warn(`[workflowBadge] state color "${color}" has no kit tone — shown neutral`);
  return tone ?? 'neutral';
}

/** What the kit `Badge` shows for a row's workflow state: the localized option label and
 *  the tone of the declared `states[].color`, never a tone read from the value text. Null
 *  for an entity without a workflow (see resolveWorkflowField) and for a row without a
 *  state; `tOption` is the caller's, because a cell renderer cannot call a hook. */
export function workflowBadge(
  meta: EntityDefinition,
  row: Row,
  tOption: (entity: string, field: string, value: string) => string,
): { label: string; color: BadgeProps['color'] } | null {
  const wf = resolveWorkflowField(meta);
  if (!wf) return null;
  const val = row[wf];
  if (val == null || val === '') return null;
  const state = meta.states?.find((s) => s.value === val);
  return { label: tOption(meta.name, wf, String(val)), color: stateTone(state?.color) };
}
