import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn.js';

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const;

/** Sheet detents, smallest → largest (P3: medium ≈ half sheet, large ≈ full). */
const DETENT_ORDER = ['medium', 'large'] as const;
export type SheetDetent = (typeof DETENT_ORDER)[number];

// The VISUAL detent heights live in the iOS variant CSS (50vh / 90vh, keyed on
// data-detent). These fractions only steer the grabber-DRAG state machine — its
// clamp and its release snap — so the component never hardcodes a look.
const DETENT_FRACTION: Record<SheetDetent, number> = { medium: 0.5, large: 0.9 };
/** Viewport fallback when unmeasurable (jsdom reports 768 itself; belt+braces). */
const VIEWPORT_FALLBACK_H = 768;
/** Movement (px) below which a grabber press is a click (cycle), not a drag. */
const DETENT_DRAG_SLOP = 8;

// Exit-animation lifetime: the node lingers this long after close so the exit
// keyframe can play. Covers the longest exit (a sheet-out at --duration-slow,
// up to ~320ms on iOS); the pop-out path is shorter and unaffected.
const EXIT_MS = 220;

export interface BaseDialogProps {
  open: boolean;
  onClose: () => void;
  /** Visible heading; also names the dialog for assistive tech. */
  title?: ReactNode;
  /** Accessible name when there is no visible title. */
  ariaLabel?: string;
  /** Max-width preset for the panel. */
  size?: keyof typeof SIZES;
  /** Presentation: 'auto' = responsive (bottom sheet on phones, centered modal on
   *  desktop — today's behavior); 'sheet' = always a bottom sheet (grabber +
   *  slide-up); 'center' = always centered. */
  presentation?: 'auto' | 'sheet' | 'center';
  /** Sheet detents (sheet presentation only): declare snap heights and the
   *  grabber becomes a real button — drag it (Pointer Events, snap on release),
   *  click it (cycles), or Arrow Up/Down on it to switch. The panel carries
   *  data-detent="medium|large"; the iOS variant CSS maps those to ~50vh/~90vh.
   *  Omit for today's auto-height sheet (fully backward compatible). */
  detents?: SheetDetent[];
  /** Detent applied on every (re)open; default = the smallest declared detent. */
  defaultDetent?: SheetDetent;
  /** Fires when the USER switches detents (drag, click, or keyboard). */
  onDetentChange?: (detent: SheetDetent) => void;
  /** Accessible name prefix of the grabber button (default "Sheet height"). */
  detentLabel?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Hide the default close (×) control. */
  hideClose?: boolean;
  closeLabel?: string;
  className?: string;
  /** Element to focus on open; default = first focusable in the BODY. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Restore focus to the opener on close (default true). */
  restoreFocus?: boolean;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Count of open dialogs (body scroll-lock lifetime). "Which dialog is on top"
// is answered by DOM order instead of a stack: portals append to body in
// OPEN order, while React runs child effects before parent effects — a stack
// filled in effect order would be upside down for nested dialogs.
let openDialogCount = 0;

/**
 * Generic modal shell — the foundation every dialog builds on (SearchDialog and
 * any future dialog type). Owns the portal-to-body, the backdrop, Escape-to-close,
 * a self-contained focus trap and the dialog ARIA.
 *
 * Focus rules (the load-bearing part):
 *  - Initial focus goes into the BODY (first focusable there, or
 *    `initialFocusRef`), never onto the header × — a search dialog must open
 *    typing-ready.
 *  - The focus effect is keyed on `open` ONLY; `onClose` is read through a ref,
 *    so an inline-arrow onClose (new identity per host render) can NEVER re-run
 *    the effect and yank focus mid-typing.
 *  - Escape listens in the BUBBLE phase and respects `e.defaultPrevented`:
 *    [[Popover]] consumes Escape in the capture phase, so an open dropdown
 *    closes itself without closing its host dialog. Only the topmost dialog
 *    of the stack reacts at all.
 *  - Focus restores to the opener on close (opt out via `restoreFocus`).
 * Body scroll is locked while any dialog is open. Bottom sheet on phones,
 * centered modal on desktop.
 */
export function BaseDialog({
  open,
  onClose,
  title,
  ariaLabel,
  size = 'md',
  presentation = 'auto',
  detents,
  defaultDetent,
  onDetentChange,
  detentLabel = 'Sheet height',
  children,
  footer,
  hideClose,
  closeLabel = 'Close',
  className,
  initialFocusRef,
  restoreFocus = true,
}: BaseDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Exit presence: after `open` flips false the node stays mounted for one
  // beat so anim-pop-out can play. Everything behavioral (focus restore,
  // scroll-lock, Escape ownership) still keys off `open` and ends instantly —
  // only the pixels linger.
  const [present, setPresent] = useState(open);
  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    if (!present) return;
    const t = setTimeout(() => setPresent(false), EXIT_MS);
    return () => clearTimeout(t);
  }, [open, present]);

  // Unstable callback props go through refs so the [open]-keyed effect below
  // never re-runs (and never re-focuses) because a host re-rendered.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const restoreFocusRef = useRef(restoreFocus);
  restoreFocusRef.current = restoreFocus;

  // ── Detents (sheet presentation only) ──────────────────────────────────────
  // Normalize to canonical small→large order and validate the default, so the
  // step/cycle logic is deterministic whatever order the host declared.
  const sortedDetents = DETENT_ORDER.filter((d) => detents?.includes(d));
  const hasDetents = presentation === 'sheet' && sortedDetents.length > 0;
  const resolvedDefault =
    defaultDetent != null && sortedDetents.includes(defaultDetent) ? defaultDetent : sortedDetents[0];
  const [detentState, setDetentState] = useState<SheetDetent | undefined>(resolvedDefault);
  const detent = detentState != null && sortedDetents.includes(detentState) ? detentState : resolvedDefault;

  // Every (re)open presents at the declared default (the iOS contract). Read
  // through a ref so array identity churn can never re-run the effect.
  const defaultDetentRef = useRef(resolvedDefault);
  defaultDetentRef.current = resolvedDefault;
  useEffect(() => {
    if (open) setDetentState(defaultDetentRef.current);
  }, [open]);

  // Grabber drag: pointer-captured vertical tracking with a snap-to-nearest on
  // release. jsdom note: panel/viewport heights are unmeasurable there — the
  // state machine falls back to DETENT_FRACTION × 768, so thresholds stay
  // deterministic under test. Called only from event handlers (no effects), so
  // the callbacks need no ref indirection.
  const detentDragRef = useRef<{ id: number; startY: number; startH: number; active: boolean } | null>(null);
  const dragHeightRef = useRef<number | null>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const suppressClickRef = useRef(false);

  const detentPx = (d: SheetDetent) =>
    (typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : VIEWPORT_FALLBACK_H) *
    DETENT_FRACTION[d];

  const changeDetent = (next: SheetDetent | undefined) => {
    if (next == null || next === detent) return;
    setDetentState(next);
    onDetentChange?.(next);
  };

  /** Keyboard/click path: step ±1 through the detents (no wrap). */
  const stepDetent = (dir: 1 | -1) => {
    const i = detent != null ? sortedDetents.indexOf(detent) : -1;
    changeDetent(sortedDetents[i + dir]);
  };

  const onGrabberPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const measured = panelRef.current?.offsetHeight ?? 0;
    detentDragRef.current = {
      id: e.pointerId,
      startY: e.clientY,
      startH: measured > 0 ? measured : detentPx(detent ?? sortedDetents[0]!),
      active: false,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onGrabberPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = detentDragRef.current;
    if (!d || e.pointerId !== d.id) return;
    const dy = e.clientY - d.startY;
    if (!d.active) {
      if (Math.abs(dy) < DETENT_DRAG_SLOP) return;
      d.active = true;
    }
    // Track the finger 1:1 (dragging UP grows the sheet), clamped to the
    // declared detent range; the snap happens on release.
    const min = detentPx(sortedDetents[0]!);
    const max = detentPx(sortedDetents[sortedDetents.length - 1]!);
    const next = Math.max(min, Math.min(max, d.startH - dy));
    dragHeightRef.current = next;
    setDragHeight(next);
  };

  const onGrabberPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = detentDragRef.current;
    if (!d || e.pointerId !== d.id) return;
    detentDragRef.current = null;
    if (!d.active) return; // a plain press — the click event cycles instead
    suppressClickRef.current = true; // the browser fires click after this drag
    const h = dragHeightRef.current ?? d.startH;
    dragHeightRef.current = null;
    setDragHeight(null);
    changeDetent(
      sortedDetents.reduce((best, cand) => (Math.abs(detentPx(cand) - h) < Math.abs(detentPx(best) - h) ? cand : best)),
    );
  };

  const onGrabberPointerCancel = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = detentDragRef.current;
    if (!d || e.pointerId !== d.id) return;
    detentDragRef.current = null;
    dragHeightRef.current = null;
    setDragHeight(null);
  };

  /** Gesture-free path #1: activating the grabber cycles through the detents. */
  const onGrabberClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const i = detent != null ? sortedDetents.indexOf(detent) : -1;
    changeDetent(sortedDetents[(i + 1) % sortedDetents.length]);
  };

  /** Gesture-free path #2: Arrow Up = larger, Arrow Down = smaller. */
  const onGrabberKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    stepDetent(e.key === 'ArrowUp' ? 1 : -1);
  };

  useEffect(() => {
    if (!open) return;
    openDialogCount += 1;
    document.body.style.overflow = 'hidden';
    // Topmost = the LAST open dialog overlay in the DOM (portals append in
    // open order — independent of React's child-before-parent effect order).
    const isTop = () => {
      const overlays = document.querySelectorAll('[data-dialog-overlay]');
      return overlays[overlays.length - 1] === overlayRef.current;
    };

    restoreRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusable = () =>
      panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
    const bodyFocusable = () =>
      bodyRef.current ? Array.from(bodyRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
    (initialFocusRef?.current ?? bodyFocusable()[0] ?? focusable()[0] ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      // Not the top dialog → not our event (an inner dialog owns it).
      if (!isTop()) return;
      if (e.key === 'Escape') {
        // A capture-phase consumer (Popover/Combobox dropdown) already used
        // this Escape to close itself — the dialog stays.
        if (e.defaultPrevented) return;
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab') {
        const f = focusable();
        if (f.length === 0) {
          e.preventDefault();
          panel?.focus();
          return;
        }
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    // Bubble phase (capture: false): Popover's capture-phase Escape handler
    // always runs first — deterministic layering without listener-order games.
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      openDialogCount -= 1;
      if (openDialogCount === 0) document.body.style.overflow = '';
      if (restoreFocusRef.current) restoreRef.current?.focus?.();
    };
    // initialFocusRef is a ref (stable identity by contract) — open is the
    // only value that may re-run this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open && !present) return null;
  const closing = !open && present;

  return createPortal(
    <div
      ref={overlayRef}
      data-ui="dialog-overlay"
      data-presentation={presentation}
      {...(closing ? {} : { 'data-dialog-overlay': '' })}
      className={cn(
        // Scrim rides an overridable var (--color-scrim) with the historical
        // black/30 as its default — same var(--x, fallback) hook idiom as the
        // theme's --glow-color; designs/theme can re-tint it without a kit change.
        'fixed inset-0 z-dialog flex items-end justify-center bg-[color:var(--color-scrim,rgba(0,0,0,0.30))] backdrop-blur-sm transition-opacity duration-base sm:items-center',
        closing && 'pointer-events-none opacity-0',
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        data-ui="dialog"
        data-size={size}
        data-presentation={presentation}
        {...(hasDetents && detent != null ? { 'data-detent': detent } : {})}
        role="dialog"
        aria-modal="true"
        aria-label={title ? undefined : ariaLabel}
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        // While the grabber drag tracks the finger, the inline height wins and
        // the height transition is zeroed; on release both clear and the
        // data-detent CSS snaps the panel to the chosen stop.
        style={dragHeight != null ? { height: `${dragHeight}px`, transitionDuration: '0ms' } : undefined}
        className={cn(
          closing ? 'anim-pop-out' : 'anim-pop-in',
          'flex max-h-[90vh] w-full flex-col rounded-t-dialog bg-surface shadow-lg outline-none sm:rounded-dialog',
          SIZES[size],
          className,
        )}
      >
        {presentation === 'sheet' &&
          (hasDetents ? (
            // Detent sheets upgrade the grabber to a REAL button (a11y contract:
            // resizable without the gesture) — the visual pill keeps the
            // data-ui="sheet-grabber" hook, so variant CSS styles both flavors.
            <button
              type="button"
              data-ui="sheet-grabber-button"
              aria-label={`${detentLabel}: ${detent}`}
              onClick={onGrabberClick}
              onKeyDown={onGrabberKeyDown}
              onPointerDown={onGrabberPointerDown}
              onPointerMove={onGrabberPointerMove}
              onPointerUp={onGrabberPointerUp}
              onPointerCancel={onGrabberPointerCancel}
              onLostPointerCapture={onGrabberPointerCancel}
              className="mx-auto flex h-6 w-16 shrink-0 cursor-grab touch-none items-center justify-center rounded-full focus-visible:shadow-focus focus-visible:outline-none"
            >
              <span data-ui="sheet-grabber" aria-hidden="true" className="h-1 w-9 rounded-full bg-neutral-300" />
            </button>
          ) : (
            <div
              data-ui="sheet-grabber"
              aria-hidden="true"
              className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-neutral-300"
            />
          ))}
        {(title || !hideClose) && (
          <div data-ui="dialog-header" className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
            {title ? (
              <h2 id={titleId} className="truncate text-base font-semibold text-textMain">
                {title}
              </h2>
            ) : (
              <span />
            )}
            {!hideClose && (
              <button
                type="button"
                aria-label={closeLabel}
                onClick={onClose}
                className="shrink-0 rounded p-1 text-textMuted transition-colors duration-base hover:bg-bgHover hover:text-textMain focus-visible:shadow-focus focus-visible:outline-none"
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
                  <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
        )}
        <div ref={bodyRef} data-ui="dialog-body" className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {children}
        </div>
        {footer && <div data-ui="dialog-footer" className="border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
