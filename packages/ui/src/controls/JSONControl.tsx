import { useState } from 'react';
import type { FieldControlProps } from '@/controls/types';
import { TEXTAREA_CLASS, describedBy } from '@/controls/control-styles';

/** Multi-line JSON editor backed by a raw text buffer. Edits keep the raw text
 *  so a half-typed value isn't clobbered; on blur we parse and only emit on
 *  success. Invalid JSON keeps the text (the form's zod error surfaces it). */
export default function JSONControl({
  value,
  state,
  onChange,
  controlId,
  labelId,
  describedById,
  errorId,
}: FieldControlProps) {
  const [text, setText] = useState<string>(value == null ? '' : JSON.stringify(value, null, 2));
  return (
    <textarea
      data-ui="input"
      id={controlId}
      className={TEXTAREA_CLASS}
      rows={6}
      aria-labelledby={labelId}
      aria-describedby={describedBy(describedById, errorId)}
      aria-required={state.required || undefined}
      aria-invalid={state.invalid || undefined}
      readOnly={state.readOnly}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text.trim() === '') {
          onChange(null); // null (not undefined) survives JSON.stringify so the clear reaches the engine
          return;
        }
        try {
          onChange(JSON.parse(text));
        } catch {
          /* keep raw text; validation surfaces the error */
        }
      }}
    />
  );
}
