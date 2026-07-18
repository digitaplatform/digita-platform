import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { cn } from '../lib/cn.js';
import { Menu, MenuItem } from '../composites/Menu.js';

/**
 * P2.2 — swipe actions for list rows (ROADMAP 2.2, policy §3 "Row action").
 *
 * A list-row wrapper with swipe-revealed action trays. On a COARSE pointer
 * (touch/pen — decided per event via `pointerType`, so no media-query state), a
 * horizontal Pointer-Events drag slides the row content and reveals the
 * leading/trailing tray behind it; releasing past HALF the tray width latches
 * it open, a `fullSwipe` past the commit threshold fires the FIRST action of
 * that side. Escape and an outside tap reset. Vertical scrolling stays native
 * (`touch-action: pan-y` + an axis lock on the first move).
 *
 * On a FINE pointer (mouse) the drag is NEVER hijacked: the same trailing tray
 * doubles as the desktop hover row (pure CSS in variants/base.css —
 * `@media (hover: hover) and (pointer: fine)`), and the built-in "…" menu is
 * the click path.
 *
 * Accessibility (gesture-free by construction): every action is a real
 * `<button>` — the tray buttons stay in the tab order and REVEAL THE TRAY ON
 * FOCUS, and the same actions repeat inside a keyboard-openable `role="menu"`
 * (the kit [[Menu]]: Escape closes, focus returns to the trigger, danger
 * actions render in the error colour). Escape anywhere in the row closes an
 * open tray and parks focus back on the row.
 *
 * Hooks: `data-ui="swipe-row"` (+ `data-open="none|leading|trailing"`),
 * `"swipe-row-content"`, `"swipe-row-actions"` (+ `data-side`),
 * `"swipe-row-action"` (+ `data-variant`), `"swipe-row-menu"`. The iOS layer
 * paints delete red / more gray and the spring snap in the premium ios variant
 * CSS (digita-plugins-store); the neutral
 * default is token-styled (danger = error tokens).
 *
 * jsdom note: tray/row widths are unmeasurable there — the state machine falls
 * back to fixed per-action / row widths so the latch & commit thresholds stay
 * deterministic under test.
 */

export interface SwipeAction {
  key: string;
  label: string;
  icon?: ReactNode;
  variant?: 'default' | 'danger';
  onAction: () => void;
}

export interface SwipeRowProps extends HTMLAttributes<HTMLDivElement> {
  /** Row content — slides sideways over the action trays. */
  children: ReactNode;
  /** Actions revealed by swiping RIGHT (tray on the left edge). */
  leading?: SwipeAction[];
  /** Actions revealed by swiping LEFT (tray on the right edge). */
  trailing?: SwipeAction[];
  /** A swipe far past the tray commits the FIRST action of that side. */
  fullSwipe?: boolean;
  /** Accessible name of the built-in actions menu (default "Row actions"). */
  menuLabel?: string;
}

/** Fallback widths when layout is unmeasurable (jsdom / display:none). */
const ACTION_FALLBACK_W = 88;
const ROW_FALLBACK_W = 360;
/** Movement (px) below which a touch is a tap, not a drag. */
const DRAG_SLOP = 8;
/** Extra distance past the open tray that commits the full swipe. */
const COMMIT_OVERSHOOT = 56;

type Side = 'leading' | 'trailing';

interface DragState {
  id: number;
  startX: number;
  startY: number;
  base: number;
  active: boolean;
  trayL: number;
  trayR: number;
  rowW: number;
}

function EllipsisIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-4 w-4">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

function measure(el: HTMLElement | null, fallback: number): number {
  const w = el?.offsetWidth ?? 0;
  return w > 0 ? w : fallback;
}

export const SwipeRow = forwardRef<HTMLDivElement, SwipeRowProps>(function SwipeRow(
  { children, leading = [], trailing = [], fullSwipe = false, menuLabel = 'Row actions', className, ...props },
  ref,
) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const leadingTrayRef = useRef<HTMLDivElement>(null);
  const trailingTrayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const offsetRef = useRef(0);

  const [open, setOpen] = useState<Side | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as MutableRefObject<HTMLDivElement | null>).current = node;
    },
    [ref],
  );

  const settle = useCallback((side: Side | null, px: number) => {
    offsetRef.current = px;
    setOffset(px);
    setOpen(side);
  }, []);

  const close = useCallback(() => settle(null, 0), [settle]);

  /** Keyboard path: focusing a tray button slides the tray into view. */
  const reveal = useCallback(
    (side: Side) => {
      if (dragRef.current?.active) return;
      const tray = side === 'leading' ? leadingTrayRef.current : trailingTrayRef.current;
      const count = side === 'leading' ? leading.length : trailing.length;
      const w = measure(tray, count * ACTION_FALLBACK_W);
      settle(side, side === 'leading' ? w : -w);
    },
    [leading.length, trailing.length, settle],
  );

  // Escape / outside tap reset the latched tray. Escape is consumed in the
  // CAPTURE phase (the Menu precedent) so a host BaseDialog never also closes;
  // an already-consumed Escape (open dropdown inside the row) is respected.
  useEffect(() => {
    if (open == null) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      // Focus would be stranded on a button inside the hiding tray — park it
      // back on the row so keyboard users keep their place in the list.
      if (rootRef.current?.contains(document.activeElement)) rootRef.current.focus();
      close();
    };
    const onPointer = (e: globalThis.PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, close]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Fine pointer = never hijack the drag (hover row + menu instead).
    if (e.pointerType === 'mouse') return;
    if (leading.length === 0 && trailing.length === 0) return;
    dragRef.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      base: offsetRef.current,
      active: false,
      trayL: measure(leadingTrayRef.current, leading.length * ACTION_FALLBACK_W),
      trayR: measure(trailingTrayRef.current, trailing.length * ACTION_FALLBACK_W),
      rowW: measure(rootRef.current, ROW_FALLBACK_W),
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.startX;
    if (!d.active) {
      if (Math.abs(dx) < DRAG_SLOP) return;
      // Axis lock: a mostly-vertical move is a scroll — let it stay native.
      if (Math.abs(e.clientY - d.startY) > Math.abs(dx)) {
        dragRef.current = null;
        return;
      }
      d.active = true;
      setDragging(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    const maxL = leading.length ? (fullSwipe ? d.rowW : d.trayL) : 0;
    const maxR = trailing.length ? (fullSwipe ? d.rowW : d.trayR) : 0;
    const next = Math.max(-maxR, Math.min(maxL, d.base + dx));
    offsetRef.current = next;
    setOffset(next);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.id) return;
    dragRef.current = null;
    setDragging(false);
    if (!d.active) {
      // A plain tap on the content while a tray is latched closes it (iOS).
      if (open != null) close();
      return;
    }
    const off = offsetRef.current;
    if (off > 0 && leading.length > 0) {
      const commit = Math.max(d.trayL + COMMIT_OVERSHOOT, d.rowW * 0.6);
      if (fullSwipe && off >= commit) {
        close();
        leading[0]?.onAction();
      } else if (off >= d.trayL / 2) settle('leading', d.trayL);
      else close();
    } else if (off < 0 && trailing.length > 0) {
      const commit = Math.max(d.trayR + COMMIT_OVERSHOOT, d.rowW * 0.6);
      if (fullSwipe && -off >= commit) {
        close();
        trailing[0]?.onAction();
      } else if (-off >= d.trayR / 2) settle('trailing', -d.trayR);
      else close();
    } else close();
  };

  const cancelDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.id) return;
    dragRef.current = null;
    setDragging(false);
    settle(open, open === 'leading' ? d.trayL : open === 'trailing' ? -d.trayR : 0);
  };

  const runAction = (action: SwipeAction) => {
    close();
    action.onAction();
  };

  const renderTray = (side: Side, actions: SwipeAction[]) => {
    if (actions.length === 0) return null;
    const visible = open === side || (side === 'leading' ? offset > 0 : offset < 0);
    return (
      <div
        ref={side === 'leading' ? leadingTrayRef : trailingTrayRef}
        data-ui="swipe-row-actions"
        data-side={side}
        role="group"
        aria-label={side === 'leading' ? 'Leading row actions' : 'Trailing row actions'}
        onFocus={() => reveal(side)}
        className={cn(
          'absolute inset-y-0 flex items-stretch transition-opacity duration-base ease-smooth',
          side === 'leading' ? 'left-0' : 'right-0',
          visible ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            data-ui="swipe-row-action"
            data-variant={action.variant ?? 'default'}
            onClick={() => runAction(action)}
            className={cn(
              'flex min-w-[4.5rem] flex-col items-center justify-center gap-0.5 px-3 text-sm font-medium',
              'transition duration-base ease-smooth focus-visible:outline-none focus-visible:shadow-focus',
              action.variant === 'danger' ? 'bg-error text-onError' : 'bg-subtle text-textMain',
            )}
          >
            {action.icon != null && (
              <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center">
                {action.icon}
              </span>
            )}
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    );
  };

  const allActions = [...leading, ...trailing];

  return (
    <div
      ref={setRefs}
      {...props}
      data-ui="swipe-row"
      data-open={open ?? 'none'}
      tabIndex={-1}
      onBlur={(e) => {
        // Keyboard leaves the row entirely → don't strand an open tray.
        if (open != null && !e.currentTarget.contains(e.relatedTarget as Node | null)) close();
      }}
      className={cn('relative overflow-hidden outline-none', className)}
    >
      {renderTray('leading', leading)}
      <div
        data-ui="swipe-row-content"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={cancelDrag}
        onLostPointerCapture={cancelDrag}
        style={{
          transform: `translateX(${offset}px)`,
          touchAction: 'pan-y',
          ...(dragging ? { transitionDuration: '0ms' } : null),
        }}
        className="relative flex items-center bg-surface transition-transform duration-base ease-smooth"
      >
        <div className="min-w-0 flex-1">{children}</div>
        {allActions.length > 0 && (
          <span data-ui="swipe-row-menu" className="shrink-0 self-center pr-1">
            <Menu
              label={menuLabel}
              trigger={<EllipsisIcon />}
              triggerClassName={cn(
                'flex h-9 w-9 items-center justify-center rounded-btn text-textMuted',
                'transition duration-base ease-smooth hover:bg-bgHover hover:text-textMain',
                'focus-visible:outline-none focus-visible:shadow-focus',
              )}
            >
              {(closeMenu) =>
                allActions.map((action) => (
                  <MenuItem
                    key={action.key}
                    icon={action.icon}
                    danger={action.variant === 'danger'}
                    onSelect={() => {
                      closeMenu();
                      runAction(action);
                    }}
                  >
                    {action.label}
                  </MenuItem>
                ))
              }
            </Menu>
          </span>
        )}
      </div>
      {renderTray('trailing', trailing)}
    </div>
  );
});
