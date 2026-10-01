import { useState } from 'react';
import { Input } from '@digitaplatform/components';
import type { FieldControlProps } from '@/controls/types';
import { describedBy } from '@/controls/control-styles';
import { currencyFractionDigits } from '@/lib/format';
import { useSessionStore } from '@/stores/session';

/** Currency editor: a plain right-aligned decimal number. The currency symbol is
 *  a read-view concern, so the editor stays a bare number, but it shows the
 *  fraction digits of the currency (208.70, never 208.7) except while the person
 *  types. Emits `undefined` (not 0) for a blank input so conditional-required can
 *  tell empty from a real 0. */
export default function CurrencyControl({
  field,
  value,
  doc,
  state,
  onChange,
  inGrid,
  controlId,
  labelId,
  describedById,
  errorId,
}: FieldControlProps) {
  const defaultCurrency = useSessionStore((s) => s.settings?.default_currency);
  // What the person types, kept as typed while the field has focus: rewriting it to
  // fixed digits on each key would move the caret and turn "12.5" into "12.50".
  const [typed, setTyped] = useState<string | null>(null);
  const currency = (field.currency_field ? String(doc[field.currency_field] ?? '') : '') || defaultCurrency;
  const number = value == null || value === '' ? null : Number(value);
  // A grid cell editor shows the raw number: the grid seeds the first typed key as the
  // value, and the cell shows the formatted amount once the editor closes.
  const shown =
    typed ??
    (number === null ? '' : inGrid || isNaN(number) ? String(value) : number.toFixed(currencyFractionDigits(currency, field.precision)));
  return (
    <Input
      id={controlId}
      type="number"
      inputMode="decimal"
      step="any"
      className="text-right tabular-nums"
      aria-labelledby={labelId}
      aria-describedby={describedBy(describedById, errorId)}
      aria-required={state.required || undefined}
      aria-invalid={state.invalid || undefined}
      readOnly={state.readOnly}
      placeholder={field.placeholder}
      value={shown}
      onFocus={inGrid ? undefined : (e) => e.currentTarget.select()}
      onBlur={() => setTyped(null)}
      onChange={(e) => {
        const v = e.target.value;
        setTyped(v);
        onChange(v === '' ? undefined : Number(v));
      }}
    />
  );
}
