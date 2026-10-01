import { Input } from '@digitaplatform/components';
import type { FieldControlProps } from '@/controls/types';
import { describedBy } from '@/controls/control-styles';
import { fromDatetimeInput, toDatetimeInput } from '@/lib/format';
import { useSessionStore } from '@/stores/session';

/** Date + time on the wall clock of the person's time zone, the time the list shows.
 *  A `datetime-local` input carries no zone, so the stored UTC instant is converted
 *  for display and what the person types is stored as its UTC instant; emits
 *  `undefined` when cleared. */
export default function DatetimeControl({
  field,
  value,
  state,
  onChange,
  controlId,
  labelId,
  describedById,
  errorId,
}: FieldControlProps) {
  const timezone = useSessionStore((s) => s.locale?.timezone);
  return (
    <Input
      id={controlId}
      type="datetime-local"
      aria-labelledby={labelId}
      aria-describedby={describedBy(describedById, errorId)}
      aria-required={state.required || undefined}
      aria-invalid={state.invalid || undefined}
      readOnly={state.readOnly}
      placeholder={field.placeholder}
      value={toDatetimeInput(value, timezone)}
      onChange={(e) => onChange(fromDatetimeInput(e.target.value, timezone))}
    />
  );
}
