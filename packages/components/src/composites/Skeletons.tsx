import { Skeleton } from '../primitives/Skeleton.js';
import { tableSkin } from '../lib/table-skin.js';
import { cn } from '../lib/cn.js';

/**
 * Loading choreography — skeletons shaped like the content they replace, so a
 * loading page keeps its layout (no spinner-block → content jump). Three
 * shapes cover the app's main surfaces: list table, record form, dashboard
 * cards. Deterministic pseudo-random widths (index-derived) keep the bars from
 * looking machine-stamped without breaking SSR/test stability.
 */

const widths = ['w-3/5', 'w-2/5', 'w-4/5', 'w-1/2', 'w-3/4', 'w-2/3'] as const;
const w = (i: number) => widths[i % widths.length]!;

export function TableSkeleton({
  columns = 5,
  rows = 8,
  className,
}: {
  columns?: number;
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn(tableSkin.frame, 'overflow-hidden', className)} aria-hidden="true">
      <div
        className={cn(tableSkin.header, 'grid gap-4 px-4 py-2.5')}
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: columns }, (_, c) => (
          <Skeleton key={c} className={cn('h-3', w(c))} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          className="grid gap-4 border-b border-border px-4 py-3 last:border-b-0"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cn('h-3.5', w(r + c))} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function FormSkeleton({
  fields = 8,
  className,
}: {
  fields?: number;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-x-6 gap-y-5 md:grid-cols-2', className)} aria-hidden="true">
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className={cn('h-3', i % 3 === 0 ? 'w-1/3' : 'w-1/4')} />
          {/* Bar height = the shared single-line control height (BUG-2): the bar and
              the real Input it replaces settle at the same 42px, so no 36→42px jump.
              `--control-h` (design token) overrides the literal default. */}
          <Skeleton className="h-[var(--control-h,2.625rem)] w-full rounded-input" />
        </div>
      ))}
    </div>
  );
}

export function CardsSkeleton({
  cards = 4,
  className,
}: {
  cards?: number;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-4', className)} aria-hidden="true">
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="rounded-card border border-border bg-surface p-5">
          <Skeleton className={cn('h-3', w(i))} />
          <Skeleton className="mt-3 h-7 w-1/2" />
          <Skeleton className={cn('mt-2 h-3', w(i + 2))} />
        </div>
      ))}
    </div>
  );
}
