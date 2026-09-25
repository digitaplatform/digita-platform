import { Input } from '@digitaplatform/components';
import type { FieldControlProps } from '@/controls/types';
import { describedBy } from '@/controls/control-styles';

/** Currency editor: a plain right-aligned decimal number. The currency symbol is
 *  a read-view concern, so the editor stays a bare number. Emits `undefined`
 *  (not 0) for a blank input so conditional-required can tell empty from a real 0. */
export default function CurrencyControl({
  field,
  value,
  state,
  onChange,
  inGrid,
  controlId,
  labelId,
  describedById,
  errorId,
}: FieldControlProps) {
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
      value={value == null ? '' : String(value)}
      onFocus={inGrid ? undefined : (e) => e.currentTarget.select()}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === '' ? undefined : Number(v));
      }}
    />
  );
}
