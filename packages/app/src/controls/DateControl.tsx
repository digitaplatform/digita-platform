import { DatePicker } from '@digitaplatform/components';
import { useSessionStore } from '@/stores/session';
import type { FieldControlProps } from '@/controls/types';
import { describedBy } from '@/controls/control-styles';

/**
 * NORDSTERN F8 — Date-only, on the themed DatePicker (was <input type="date">;
 * native chrome matches no design). Emits 'YYYY-MM-DD' or undefined, unchanged.
 * Read-only state renders the plain formatted trigger, disabled.
 */
export default function DateControl({
  field,
  value,
  state,
  onChange,
  onCommit,
  controlId,
  labelId,
  describedById,
  errorId,
}: FieldControlProps) {
  const formatLocale = useSessionStore((s) => s.locale?.format_locale);
  return (
    <DatePicker
      id={controlId}
      locale={formatLocale}
      aria-labelledby={labelId}
      aria-describedby={describedBy(describedById, errorId)}
      aria-required={state.required || undefined}
      invalid={state.invalid}
      disabled={state.readOnly}
      placeholder={field.placeholder}
      value={value == null ? undefined : String(value).slice(0, 10)}
      // Every pick commits (like LinkControl): the DatePicker is a button, not an
      // Enter-commit input, and 'Date' was removed from ENTER_EXIT_TYPES — so the
      // onCommit contract is what advances an entry_flow + lets the grid close the
      // editor on a keyboard-driven pick. No-op (undefined) in a record form.
      onChange={(v) => {
        onChange(v ?? undefined);
        onCommit?.();
      }}
    />
  );
}
