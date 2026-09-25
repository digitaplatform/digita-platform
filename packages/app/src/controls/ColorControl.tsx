import { Input } from '@digitaplatform/components';
import type { FieldControlProps } from '@/controls/types';
import { describedBy } from '@/controls/control-styles';

/** Color picker paired with a free-text hex field. The native swatch always
 *  shows a concrete color (falls back to #000000); the text input drives the
 *  document value and emits undefined when cleared. */
export default function ColorControl({
  value,
  state,
  onChange,
  controlId,
  labelId,
  describedById,
  errorId,
}: FieldControlProps) {
  const hex = typeof value === 'string' && value ? value : '#000000';
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        className="h-9 w-12 rounded border border-border bg-surface"
        disabled={state.readOnly}
        value={hex}
        onChange={(e) => onChange(e.target.value)}
      />
      <Input
        id={controlId}
        type="text"
        aria-labelledby={labelId}
        aria-describedby={describedBy(describedById, errorId)}
        aria-required={state.required || undefined}
        aria-invalid={state.invalid || undefined}
        readOnly={state.readOnly}
        placeholder="#000000"
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      />
    </div>
  );
}
