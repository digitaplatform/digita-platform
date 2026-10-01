import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';

/**
 * One field of a record form: the label row, the control and the messages under it.
 * The row carries no state of its own; a design reads the control's state through
 * the row (`[data-ui="form-row"]:has([aria-invalid="true"])`, `:has([readonly])`),
 * because the control, not the row, is what a browser and a screen reader see as
 * invalid or locked.
 *
 * `labelAction` sits beside the label, outside it: an interactive element must not
 * nest in a `<label>`, whose click forwards to the control.
 */

export interface FormRowProps extends HTMLAttributes<HTMLDivElement> {
  /** The control's id; the label points at it. */
  controlId: string;
  labelId?: string;
  label: string;
  required?: boolean;
  /** Glyphs after the label text, inside the label (a frozen marker, …). */
  labelIcon?: ReactNode;
  labelAction?: ReactNode;
  /** The field's error text; announced as an alert and hooked as `field-error`. */
  error?: string;
  errorId?: string;
  children: ReactNode;
}

export const FormRow = forwardRef<HTMLDivElement, FormRowProps>(function FormRow(
  { controlId, labelId, label, required = false, labelIcon, labelAction, error, errorId, className, children, ...props },
  ref,
) {
  return (
    <div ref={ref} {...props} data-ui="form-row" className={cn('space-y-1', className)}>
      <div className="flex items-center gap-0.5">
        <label
          id={labelId}
          htmlFor={controlId}
          data-ui="field-label"
          className="flex min-w-0 items-center gap-0.5 text-sm font-medium text-textMain"
          title={label}
        >
          {/* Only the text truncates, so a long label stays one line while the
              required star and the icon stay visible; the title tooltip carries the full text.
              The star is for the eye only: a control that adds the label to its own name through
              aria-labelledby (a Clear beside a signature) would read it as part of the name. */}
          <span className="truncate">{label}</span>
          {required && <span className="text-error" aria-hidden="true">*</span>}
          {labelIcon}
        </label>
        {labelAction}
      </div>
      {children}
      {error && (
        <p id={errorId} data-ui="field-error" role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
});
