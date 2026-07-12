import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { cn } from '../lib/cn.js';
import { Spinner } from './Spinner.js';

/**
 * P2.2 — pull-to-refresh (ROADMAP 2.2). Wraps a scrollable area; on a COARSE
 * pointer (touch/pen — decided per event via `pointerType`), dragging DOWN
 * while everything under the finger sits at `scrollTop === 0` pulls the
 * content with a 0.5 damping; releasing past `threshold` fires `onRefresh`
 * and shows the kit [[Spinner]] until the returned promise settles.
 *
 * On a FINE pointer (mouse) the component is a transparent passthrough —
 * desktop refreshes explicitly (toolbar/⌘R), never by drag. Vertical scrolling
 * inside stays native: the pull only arms at the top, an axis lock releases
 * mostly-horizontal moves, and `overscroll-y-contain` keeps the browser's own
 * pull-to-refresh from double-firing.
 *
 * Announcements: the indicator is a `role="status"` live region with a
 * visually-hidden "Refreshing…" while pending, so the state change is
 * announced without any gesture involvement.
 *
 * Hooks: `data-ui="pull-to-refresh"` (+ `data-refreshing`) and
 * `data-ui="pull-to-refresh-indicator"`; content sits in
 * `data-ui="pull-to-refresh-content"` (the translating element the iOS layer
 * gives the spring snap-back).
 */

export interface PullToRefreshProps extends HTMLAttributes<HTMLDivElement> {
  /** Called when the pull crosses `threshold`; the spinner shows until the
   *  returned promise settles (a sync return hides it on the next tick). */
  onRefresh: () => void | Promise<void>;
  children: ReactNode;
  /** Pull distance (px, after damping) that triggers a refresh. Default 64. */
  threshold?: number;
  /** Disable the gesture entirely (passthrough). */
  disabled?: boolean;
  /** Screen-reader text while refreshing (default "Refreshing…"). */
  refreshingLabel?: string;
}

/** Finger movement is halved — the iOS-style pull resistance. */
const DAMPING = 0.5;
/** Vertical movement (px) below which the pointer is not yet a pull. */
const PULL_SLOP = 6;

interface PullState {
  id: number;
  startX: number;
  startY: number;
  active: boolean;
}

/** True when anything on the target→root path is vertically scrolled. */
function scrolledOnPath(target: Node | null, root: HTMLElement): boolean {
  for (let el = target instanceof HTMLElement ? target : null; el; el = el.parentElement) {
    if (el.scrollTop > 0) return true;
    if (el === root) break;
  }
  return false;
}

export const PullToRefresh = forwardRef<HTMLDivElement, PullToRefreshProps>(function PullToRefresh(
  {
    onRefresh,
    children,
    threshold = 64,
    disabled = false,
    refreshingLabel = 'Refreshing…',
    className,
    ...props
  },
  ref,
) {
  const dragRef = useRef<PullState | null>(null);
  const pullRef = useRef(0);
  const mountedRef = useRef(true);

  const [pull, setPull] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const max = Math.max(1, threshold);

  const setPullPx = (px: number) => {
    pullRef.current = px;
    setPull(px);
  };

  const startRefresh = () => {
    setRefreshing(true);
    setPullPx(max); // pin the indicator open while the refresh runs
    let result: unknown;
    try {
      result = onRefresh();
    } catch {
      result = undefined;
    }
    void Promise.resolve(result)
      .catch(() => undefined)
      .then(() => {
        if (!mountedRef.current) return;
        setRefreshing(false);
        setPullPx(0);
      });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Fine pointer / disabled / already refreshing = transparent passthrough.
    if (disabled || refreshing || e.pointerType === 'mouse') return;
    if (scrolledOnPath(e.target as Node, e.currentTarget)) return;
    dragRef.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, active: false };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.id) return;
    const dy = e.clientY - d.startY;
    if (!d.active) {
      if (dy < -PULL_SLOP) {
        dragRef.current = null; // scrolling up — not a pull
        return;
      }
      if (dy < PULL_SLOP) return;
      // Axis lock: a mostly-horizontal move (swipe row, carousel) is not ours.
      if (Math.abs(e.clientX - d.startX) > dy) {
        dragRef.current = null;
        return;
      }
      d.active = true;
      setPulling(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    setPullPx(Math.max(0, Math.min(dy * DAMPING, max * 1.5)));
  };

  const endPull = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.id) return;
    dragRef.current = null;
    setPulling(false);
    if (!d.active) return;
    if (pullRef.current >= max) startRefresh();
    else setPullPx(0);
  };

  const cancelPull = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.id) return;
    dragRef.current = null;
    setPulling(false);
    if (!refreshing) setPullPx(0);
  };

  return (
    <div
      ref={ref}
      {...props}
      data-ui="pull-to-refresh"
      data-refreshing={refreshing ? 'true' : 'false'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPull}
      onPointerCancel={cancelPull}
      onLostPointerCapture={cancelPull}
      className={cn('relative overflow-hidden overscroll-y-contain', className)}
    >
      {(pull > 0 || refreshing) && (
        <div
          data-ui="pull-to-refresh-indicator"
          role="status"
          aria-live="polite"
          style={{ height: max, opacity: refreshing ? 1 : Math.min(1, pull / max) }}
          className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-center"
        >
          <Spinner className="h-5 w-5 text-textMuted" />
          <span className="sr-only">{refreshing ? refreshingLabel : ''}</span>
        </div>
      )}
      <div
        data-ui="pull-to-refresh-content"
        style={{
          transform: `translateY(${pull}px)`,
          ...(pulling ? { transitionDuration: '0ms' } : null),
        }}
        className="transition-transform duration-base ease-smooth"
      >
        {children}
      </div>
    </div>
  );
});
