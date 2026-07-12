import type { ReactNode } from 'react';
import { Spinner } from '../primitives/Spinner.js';
import { cn } from '../lib/cn.js';

/**
 * Generic status blocks — loading / error / empty — shared by every React
 * frontend. Presentation only: all text comes in as props (the kit is i18n-free /
 * pre-boot), so each app passes its own localized strings. The English defaults
 * make them usable standalone.
 */

export function LoadingBlock({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 p-8 text-sm text-textMuted', className)}>
      <Spinner className="h-5 w-5" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBlock({ title = 'Something went wrong', detail }: { title?: string; detail?: string }) {
  return (
    <div role="alert" className="rounded-md border border-error bg-error-light p-4 text-sm text-error">
      <p className="font-medium">{title}</p>
      {detail && <p className="mt-1 break-words opacity-90">{detail}</p>}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  testId,
  icon,
  action,
}: {
  title: string;
  hint?: string;
  testId?: string;
  /** Optional chrome glyph, centered in a bg-subtle circle above the title. Sized
   *  to 1.5rem regardless of the passed icon's own size. */
  icon?: ReactNode;
  /** Optional call-to-action (e.g. a New button), rendered under the hint. */
  action?: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col items-center rounded-card border border-dashed border-border bg-surface px-[var(--density-pad)] py-12 text-center text-sm text-textMuted"
    >
      {icon && (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-subtle text-textMuted [&_svg]:h-6 [&_svg]:w-6">
          {icon}
        </div>
      )}
      <p className="text-base font-semibold text-textMain">{title}</p>
      {hint && <p className="mt-1">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
