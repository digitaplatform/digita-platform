import { Select } from '@digitaplatform/components';
import { useI18nStore } from '@/stores/i18n';
import { useChrome } from '@/lib/chrome-i18n';
import type { FieldControlProps } from '@/controls/types';
import { describedBy } from '@/controls/control-styles';
import { resolveOptionSource } from '@/lib/option-sources';

function optionList(options: unknown): string[] {
  if (Array.isArray(options)) return options as string[];
  if (typeof options === 'string') return options.split('\n').map((s) => s.trim()).filter(Boolean);
  return [];
}

/** Single-choice select. Options are a string[] or a newline-delimited string;
 *  labels localize via the i18n store (option.{Entity}.{field}.{value}). */
export default function SelectControl({
  field,
  value,
  entity,
  state,
  onChange,
  controlId,
  labelId,
  describedById,
  errorId,
}: FieldControlProps) {
  const tOption = useI18nStore((s) => s.tOption);
  const tc = useChrome();
  // Build options: a leading clear sentinel, then de-duped non-empty choices
  // (an empty option would collide with the sentinel + break the value key).
  // A declared built-in source (timezones/currencies/…) wins over static options.
  const seen = new Set<string>();
  const options = [{ value: '', label: '—' }];
  if (field.options_source) {
    for (const o of resolveOptionSource(field.options_source)) {
      if (o.value === '' || seen.has(o.value)) continue;
      seen.add(o.value);
      options.push(o);
    }
  } else {
    for (const o of optionList(field.options)) {
      if (o === '' || seen.has(o)) continue;
      seen.add(o);
      options.push({ value: o, label: tOption(entity, field.fieldname, o) });
    }
  }
  // Always render the stored value even if it is absent from the resolved list
  // (a deprecated code, or an environment without Intl data) — otherwise the
  // trigger would show the placeholder while a real value is held.
  const cur = value == null ? '' : String(value);
  if (cur && !seen.has(cur)) options.push({ value: cur, label: cur });
  return (
    <Select
      id={controlId}
      aria-labelledby={labelId}
      aria-describedby={describedBy(describedById, errorId)}
      aria-required={state.required || undefined}
      invalid={state.invalid}
      disabled={state.readOnly}
      searchable={options.length > 10}
      searchPlaceholder={tc('ui.list.search')}
      noResultsLabel={tc('ui.select.noResults')}
      value={value == null ? '' : String(value)}
      // Required → undefined (clean "Required" message; an empty save is blocked anyway).
      // Optional → null, which survives JSON.stringify so the cleared value actually persists.
      onChange={(v) => onChange(v === '' ? (state.required ? undefined : null) : v)}
      options={options}
    />
  );
}
