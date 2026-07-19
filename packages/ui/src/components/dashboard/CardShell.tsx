import type { ReactNode } from 'react';
import { Card, cn } from '@digitaplatform/components';
import { useChrome } from '@/lib/chrome-i18n';
import { EMPTY } from '@/lib/format';

/** Per-card render status. `locked` = no permission (calm note), `error` = LOUD
 *  red box (misconfig or transport failure), `empty` is decided by the card body
 *  (it renders the em-dash itself) so it is NOT a CardShell status here. */
export type CardStatus = 'loading' | 'locked' | 'error' | 'ready';

/** Grid width → literal Tailwind col-span class. The responsive GRID itself lives
 *  in DashboardPage (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`); width only WIDENS
 *  a card, never narrows it, and clamps to 1..3. Mobile always stacks (col-span-1 is
 *  the base; the lg: span only applies at the 3-col breakpoint). */
const WIDTH_SPAN: Record<1 | 2 | 3, string> = {
  1: 'lg:col-span-1',
  2: 'lg:col-span-2',
  3: 'lg:col-span-3',
};

function clampWidth(width: number | undefined): 1 | 2 | 3 {
  if (width === 2) return 2;
  if (width === 3) return 3;
  return 1;
}

interface CardShellProps {
  label: string;
  icon?: ReactNode;
  width?: 1 | 2 | 3;
  status: CardStatus;
  /** Loud error detail (only shown when status === 'error'). */
  error?: string;
  children?: ReactNode;
}

/**
 * Pure presentation wrapper for every dashboard card. Owns the status state
 * machine: loading → skeleton; locked → calm no-access note; error → LOUD red box;
 * ready → children. Legitimate empty data is the card body's concern (renders a
 * calm em-dash); misconfiguration is loud here.
 */
export function CardShell({ label, icon, width, status, error, children }: CardShellProps) {
  const tc = useChrome();
  const span = WIDTH_SPAN[clampWidth(width)];

  return (
    // The active signature's `card` layer rides on top of the design's card
    // surface when present (a full signature like digita — the REAL card
    // vector as a stretch-adapted data-URI SVG, painted 100%×100%); an unset
    // var falls back to the plain surface, so thin signatures are visually
    // unchanged.
    <Card className={cn('flex min-h-[8rem] flex-col bg-no-repeat bg-[length:100%_100%] bg-[image:var(--sig-card-l)] dark:bg-[image:var(--sig-card-d)]', span)}>
      <div className="mb-3 flex items-start gap-3">
        {icon && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card bg-subtle text-textMuted" aria-hidden="true">
            {icon}
          </span>
        )}
        <h3 className="truncate text-base font-semibold text-textMain">
          {label}
        </h3>
      </div>

      <div className="flex flex-1 flex-col">
        {status === 'loading' && (
          <div
            className="flex flex-1 animate-pulse flex-col justify-center gap-2"
            role="status"
            aria-label={tc('ui.status.loading')}
          >
            <div className="h-6 w-2/3 rounded bg-subtle" />
            <div className="h-4 w-1/2 rounded bg-subtle" />
          </div>
        )}

        {status === 'locked' && (
          <p className="flex flex-1 items-center justify-center text-sm text-textMuted">
            {tc('ui.dashboard.noAccess')}
          </p>
        )}

        {status === 'error' && (
          <div
            role="alert"
            className="flex-1 rounded-md border border-error bg-error-light p-3 text-sm text-error"
          >
            <p className="font-medium">{tc('ui.dashboard.cardError')}</p>
            {error && <p className="mt-1 break-words opacity-90">{error}</p>}
          </div>
        )}

        {status === 'ready' && (children ?? <span className="flex flex-1 items-center text-sm text-textMuted">{EMPTY}</span>)}
      </div>
    </Card>
  );
}
