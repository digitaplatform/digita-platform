import { Input } from '@digitaplatform/components';
import type { FieldControlProps } from '@/controls/types';
import { describedBy } from '@/controls/control-styles';

/** Masked secret entry. Value is never echoed back as plain text. */
export default function PasswordControl({
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
      type="password"
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
