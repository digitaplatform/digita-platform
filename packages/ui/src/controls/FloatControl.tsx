import { Input } from '@digitaplatform/components';
import type { FieldControlProps } from '@/controls/types';
import { describedBy } from '@/controls/control-styles';

/** Decimal number. Emits `undefined` for blank (never 0). Also the alias target
 *  for Currency/Percent display-entry until they get dedicated chrome. */
export default function FloatControl({
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
