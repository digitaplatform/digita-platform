import { Input } from '@digitaplatform/components';
import type { FieldControlProps } from '@/controls/types';
import { describedBy } from '@/controls/control-styles';

/** Time-only. Displays 'HH:mm' (trims seconds when present); emits the raw
 *  time string, or `undefined` when cleared. */
export default function TimeControl({
  field,
  value,
  state,
  onChange,
  controlId,
  labelId,
  describedById,
  errorId,
}: FieldControlProps) {
  const text =
    value == null ? '' : String(value).includes(':') ? String(value).slice(0, 5) : String(value);
  return (
    <Input
      id={controlId}
      type="time"
      aria-labelledby={labelId}
      aria-describedby={describedBy(describedById, errorId)}
      aria-required={state.required || undefined}
      aria-invalid={state.invalid || undefined}
      readOnly={state.readOnly}
      placeholder={field.placeholder}
      value={text}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
    />
  );
}
