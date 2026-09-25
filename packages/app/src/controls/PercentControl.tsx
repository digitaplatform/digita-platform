import { Input } from '@digitaplatform/components';
import type { FieldControlProps } from '@/controls/types';
import { describedBy } from '@/controls/control-styles';

/** Percent editor: a right-aligned 0–100 decimal with a static trailing `%`
 *  affordance. Emits `undefined` (not 0) for a blank input so conditional-required
 *  can tell empty from a real 0. */
export default function PercentControl({
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
    <div className="relative">
      <Input
        id={controlId}
        type="number"
        inputMode="decimal"
        step="any"
        min={0}
        max={100}
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
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-textMuted">
        %
      </span>
    </div>
  );
}
