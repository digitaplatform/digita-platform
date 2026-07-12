import type { FieldControlProps } from '@/controls/types';
import { TEXTAREA_CLASS, describedBy } from '@/controls/control-styles';

/** Multi-line text (also the alias target for TextEditor/Code/Markdown until rich
 *  variants exist, and for SmallText with fewer rows). */
export default function TextControl({
  field,
  value,
  state,
  onChange,
  controlId,
  labelId,
  describedById,
  errorId,
}: FieldControlProps) {
  const rows = field.fieldtype === 'SmallText' ? 2 : 4;
  return (
    <textarea
      data-ui="input"
      id={controlId}
      rows={rows}
      className={TEXTAREA_CLASS}
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
