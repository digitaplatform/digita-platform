import { Input } from '@digitaplatform/components';
import type { FieldControlProps } from '@/controls/types';
import { describedBy } from '@/controls/control-styles';

/** Phone number. Plain `tel` entry; validation is enforced by the zod schema. */
export default function PhoneControl({
  field,
  value,
  state,
  onChange,
  controlId,
  labelId,
  describedById,
  errorId,
}: FieldControlProps) {
  return (
    <Input
      id={controlId}
      type="tel"
      aria-labelledby={labelId}
      aria-describedby={describedBy(describedById, errorId)}
      aria-required={state.required || undefined}
      aria-invalid={state.invalid || undefined}
      readOnly={state.readOnly}
      placeholder={field.placeholder}
      value={value == null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
    />
  );
}
