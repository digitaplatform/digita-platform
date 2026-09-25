import { Input } from '@digitaplatform/components';
import type { FieldControlProps } from '@/controls/types';
import { describedBy } from '@/controls/control-styles';

/** Duration in SECONDS. Emits `undefined` (not 0) for a blank input so
 *  conditional-required can tell empty from a real 0. */
export default function DurationControl({
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
      inputMode="numeric"
      step={1}
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
