import { useCallback, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface SplitPaneProps {
  /** Left/first pane (the resized one under the default `resize="start"`). */
  first: ReactNode;
  /** Right/second pane (the resized one under `resize="end"`). */
  second: ReactNode;
  /**
   * Which pane the divider resizes (drag, arrow keys, persistence): `'start'`
   * (default) sizes the FIRST pane — the second fills; `'end'` sizes the
   * SECOND pane — the first fills. Spatial semantics follow the DIVIDER, not
   * the pane: dragging/arrowing toward a side always moves the divider that
   * way (so under `'end'`, ArrowLeft grows the panel and Home = max).
   */
  resize?: 'start' | 'end';
  /** Initial width (px) of the resized pane. */
  defaultSize?: number;
  /** Min / max width (px) of the resized pane. */
  min?: number;
  max?: number;
  /** Persist the width per user under this localStorage key (omit = ephemeral). */
  storageKey?: string;
  /**
   * Pane layout: `'scroll'` (default) wraps each pane in its own scroll
   * container; `'fill'` renders each pane as a plain flex fill — children keep
   * the full pane height and own their scrolling (editor-surface layouts where
   * inner worktops/panels scroll themselves).
   */
  panes?: 'scroll' | 'fill';
  /**
   * Collapse: unmount the RESIZED pane and the divider entirely while the
   * flexible pane keeps its tree position across the toggle — its subtree
   * (e.g. a live iframe) survives without a remount. The size state is
   * retained, so expanding restores the previous width.
   */
  collapsed?: boolean;
  /** Accessible name of the drag handle. */
  'aria-label'?: string;
  className?: string;
}

function readStored(key: string | undefined, fallback: number): number {
  if (!key || typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  const n = raw == null ? Number.NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * A resizable two-pane split with a draggable divider — the responsive building
 * block for editor layouts (e.g. a list | editor data workspace, or collapsible
 * side panels). Either side can be the resized pane (`resize`), dragged,
 * arrow-key adjustable (Shift = larger step, Home/End = the divider's extremes),
 * double-click-to-reset, and persisted per user. Token-styled only (the divider
 * highlights in the active design's `selection` colour), so it re-skins across
 * all designs; `data-ui="split*"` hooks let the variant layer refine it.
 * Collapsing is first-class via `collapsed` (the flexible pane keeps its tree
 * position, so its subtree never remounts).
 */
export function SplitPane({
  first,
  second,
  resize = 'start',
  defaultSize = 280,
  min = 160,
  max = 640,
  storageKey,
  panes = 'scroll',
  collapsed = false,
  'aria-label': ariaLabel = 'Resize panels',
  className,
}: SplitPaneProps) {
  const [size, setSize] = useState(() => Math.max(min, Math.min(max, readStored(storageKey, defaultSize))));
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const dragRef = useRef<{ startX: number; startSize: number } | null>(null);
  // Direction factor: +1 = pointer/divider moving right GROWS the resized pane
  // (resize:'start'), -1 = moving right shrinks it (resize:'end').
  const dir = resize === 'end' ? -1 : 1;

  const clamp = useCallback((n: number) => Math.max(min, Math.min(max, n)), [min, max]);
  const persist = useCallback(
    (n: number) => {
      if (storageKey && typeof window !== 'undefined') window.localStorage.setItem(storageKey, String(Math.round(n)));
    },
    [storageKey],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startSize: sizeRef.current };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setSize(clamp(d.startSize + dir * (e.clientX - d.startX)));
  };
  const endDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    persist(sizeRef.current);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 32 : 8;
    let n: number;
    if (e.key === 'ArrowLeft') n = clamp(sizeRef.current - dir * step);
    else if (e.key === 'ArrowRight') n = clamp(sizeRef.current + dir * step);
    else if (e.key === 'Home') n = dir === 1 ? min : max;
    else if (e.key === 'End') n = dir === 1 ? max : min;
    else return;
    e.preventDefault();
    setSize(n);
    persist(n);
  };
  const reset = () => {
    setSize(defaultSize);
    persist(defaultSize);
  };

  // 'scroll' panes are their own scroll containers (the defaults, unchanged).
  // 'fill' panes are single-cell GRID fills: the sole child stretches to the
  // full pane in BOTH axes regardless of its intrinsic size, so content with a
  // zero intrinsic width (e.g. a stack of absolutely-positioned surface layers)
  // fills the pane instead of collapsing it to 0px — the consumer no longer has
  // to remember a `flex-1` on its wrapper. Children still own their scrolling
  // (min-h-0/min-w-0 lets them shrink below content and scroll internally).
  const resizedCls = panes === 'fill' ? 'grid grid-cols-1 min-h-0 shrink-0' : 'min-h-0 shrink-0 overflow-auto';
  const flexibleCls = panes === 'fill' ? 'grid grid-cols-1 min-h-0 min-w-0 flex-1' : 'min-h-0 min-w-0 flex-1 overflow-auto';

  const resizedPane = !collapsed && (
    <div className={resizedCls} style={{ width: size }}>
      {resize === 'start' ? first : second}
    </div>
  );
  const flexiblePane = <div className={flexibleCls}>{resize === 'start' ? second : first}</div>;
  const divider = !collapsed && (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(size)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-ui="split-divider"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={reset}
      style={{ touchAction: 'none' }}
      className={cn(
        'relative w-px shrink-0 cursor-col-resize bg-border',
        'transition-colors duration-fast ease-smooth hover:bg-selection',
        'focus-visible:bg-selection focus-visible:outline-none',
      )}
    >
      {/* Widened invisible hit-area so the 1px divider is easy to grab. */}
      <span aria-hidden className="absolute inset-y-0 -left-1.5 -right-1.5" />
    </div>
  );

  // The flexible pane holds a STABLE child slot in both orders (collapse only
  // swaps its siblings for `false`), so React never remounts its subtree.
  return (
    <div data-ui="split" className={cn('flex min-h-0 min-w-0 items-stretch', className)}>
      {resize === 'start' ? (
        <>
          {resizedPane}
          {divider}
          {flexiblePane}
        </>
      ) : (
        <>
          {flexiblePane}
          {divider}
          {resizedPane}
        </>
      )}
    </div>
  );
}
