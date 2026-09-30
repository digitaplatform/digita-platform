import { useEffect, useState } from 'react';
import { Input } from '@digitaplatform/components';
import type { FieldControlProps } from '@/controls/types';
import { describedBy } from '@/controls/control-styles';
import { formatDuration, parseDuration } from '@/lib/format';

/** Duration, stored as whole SECONDS, shown and typed as `formatDuration` writes it
 *  under the field's `hide_days` and `hide_seconds`. Emits `undefined` (not 0) for a
 *  blank input so conditional-required can tell empty from a real 0, and the text as
 *  typed when it is no duration, so the save refuses it instead of dropping it. */
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
  // The text being typed. A grid seeds the first typed character as a text value.
  const [draft, setDraft] = useState<string | null>(typeof value === 'string' ? value : null);
  const emit = (text: string) => onChange(text.trim() === '' ? undefined : (parseDuration(text, field) ?? text));

  // A seeded character counts in the units the field shows, like every later keystroke.
  // Only in a grid: a record form never seeds, and its stored value is not rewritten on open.
  useEffect(() => {
    if (inGrid && typeof value === 'string') emit(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = value == null || value === '' ? '' : formatDuration(value, field);
  return (
    <Input
      id={controlId}
      type="text"
      className="text-right tabular-nums"
      aria-labelledby={labelId}
      aria-describedby={describedBy(describedById, errorId)}
      aria-required={state.required || undefined}
      aria-invalid={state.invalid || undefined}
      readOnly={state.readOnly}
      placeholder={field.placeholder}
      value={draft ?? shown}
      onFocus={inGrid ? undefined : (e) => e.currentTarget.select()}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        setDraft(e.target.value);
        emit(e.target.value);
      }}
    />
  );
}
