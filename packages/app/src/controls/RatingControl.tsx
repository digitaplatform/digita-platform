import type { FieldControlProps } from '@/controls/types';
import { describedBy } from '@/controls/control-styles';

/** Five-star rating. The stored value is a 0..1 fraction; clicking star `i`
 *  (1..5) emits `i / 5`. Renders as a radiogroup of toggle buttons. */
export default function RatingControl({
  value,
  state,
  onChange,
  controlId,
  labelId,
  describedById,
  errorId,
}: FieldControlProps) {
  const filledCount = Math.round((typeof value === 'number' ? value : 0) * 5);
  return (
    <div
      id={controlId}
      role="radiogroup"
      aria-labelledby={labelId}
      aria-describedby={describedBy(describedById, errorId)}
      aria-required={state.required || undefined}
      aria-invalid={state.invalid || undefined}
      className="inline-flex items-center gap-1"
    >
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = i <= filledCount;
        return (
          <button
            key={i}
            type="button"
            aria-label={`${i} of 5`}
            aria-checked={i === filledCount}
            role="radio"
            disabled={state.readOnly}
            onClick={() => onChange(i / 5)}
            className={
              filled
                ? 'text-lg leading-none text-warning disabled:cursor-not-allowed disabled:opacity-60'
                : 'text-lg leading-none text-textMuted disabled:cursor-not-allowed disabled:opacity-60'
            }
          >
            {filled ? '★' : '☆'}
          </button>
        );
      })}
    </div>
  );
}
