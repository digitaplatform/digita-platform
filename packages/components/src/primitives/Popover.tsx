import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn.js';

export interface PopoverProps {
  open: boolean;
  /** Element the panel anchors to (position + outside-click exemption). */
  anchorRef: RefObject<HTMLElement | null>;
  /** Close request: outside pointerdown or Escape. The caller owns `open`. */
  onRequestClose: () => void;
  children: ReactNode;
  /** Size the panel to the anchor's width (combobox listboxes). */
  matchAnchorWidth?: boolean;
  /** Horizontal alignment relative to the anchor (default 'start'). */
  align?: 'start' | 'end';
  /** Own the Escape key (consume + close). Disable when the host component
   *  runs its own keyboard machine (Select/Menu) — their handlers already
   *  preventDefault, which is all [[BaseDialog]] needs to stand down. */
  closeOnEscape?: boolean;
  /** Close on pointerdown outside panel+anchor. Disable when the host has its
   *  own outside-close semantics (e.g. Select's focusTrigger distinction). */
  closeOnOutsidePointer?: boolean;
  className?: string;
}

/**
 * Portaled, anchored floating panel — the ONE positioning layer for dropdown
 * surfaces (Combobox listbox, Select options, Menu panel). Renders into
 * document.body so it can never be clipped by an overflow container (the
 * DataGrid body was the live victim). Positions below the anchor, flips above
 * when the viewport runs out, clamps to the viewport, and follows the anchor
 * on scroll/resize (rAF loop while open — cheap and robust, no observer
 * bookkeeping). Escape is CONSUMED (preventDefault + stopPropagation, capture
 * phase): [[BaseDialog]] deliberately listens in the bubble phase and checks
 * `defaultPrevented`, so an open popover never closes its host dialog.
 * Non-modal: no focus trap — the anchor input keeps focus (combobox pattern).
 */
export function Popover({
  open,
  anchorRef,
  onRequestClose,
  children,
  matchAnchorWidth,
  align = 'start',
  closeOnEscape = true,
  closeOnOutsidePointer = true,
  className,
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onRequestClose);
  closeRef.current = onRequestClose;

  useEffect(() => {
    if (!open) return;

    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      const el = panelRef.current;
      if (!a || !el) return;
      const vh = window.innerHeight;
      const h = el.offsetHeight;
      const below = vh - a.bottom;
      const top = below >= h || below >= a.top ? a.bottom + 4 : a.top - h - 4;
      el.style.top = `${Math.max(4, Math.min(top, Math.max(4, vh - h - 4)))}px`;
      const left = align === 'end' ? a.right - el.offsetWidth : a.left;
      el.style.left = `${Math.max(4, Math.min(left, Math.max(4, window.innerWidth - el.offsetWidth - 4)))}px`;
      if (matchAnchorWidth) el.style.width = `${a.width}px`;
    };

    // Follow the anchor while open: covers container scrolling (grid bodies),
    // window resize and any layout shift without element-specific listeners.
    let raf = 0;
    const loop = () => {
      place();
      raf = requestAnimationFrame(loop);
    };
    place();
    raf = requestAnimationFrame(loop);
    window.addEventListener('resize', place);

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      closeRef.current();
    };
    // Capture phase so the popover claims Escape BEFORE bubble-phase dialog
    // handlers; preventDefault marks the event as consumed for them.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
    };
    if (closeOnOutsidePointer) document.addEventListener('pointerdown', onPointerDown);
    if (closeOnEscape) document.addEventListener('keydown', onKeyDown, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, anchorRef, matchAnchorWidth, align, closeOnEscape, closeOnOutsidePointer]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      data-ui="popover"
      className={cn(
        'anim-pop-in fixed z-popover overflow-hidden rounded-card border border-border bg-surfaceGlass shadow-md backdrop-blur-md',
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
