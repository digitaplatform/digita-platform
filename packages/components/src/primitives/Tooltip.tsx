import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn.js';

/**
 * Tooltip that reveals a label on hover + keyboard focus. The bubble is rendered
 * through a portal at <body> with fixed positioning, so it is never clipped by an
 * overflow ancestor (menus, popovers, scroll panels). Token-styled to match the
 * floating menus (glass + blur). For icon-only buttons the trigger must ALSO carry
 * an aria-label — the bubble is aria-hidden (purely visual), not the accessible
 * name. Hidden on scroll/resize so it never strands at a stale position.
 */
export interface TooltipProps {
  label: string;
  side?: 'top' | 'bottom';
  /** Wrap sentence-length labels (e.g. field descriptions) into a width-capped,
   *  left-aligned bubble instead of the default single nowrap line — which would
   *  otherwise run off both viewport edges. */
  multiline?: boolean;
  children: ReactNode;
  className?: string;
}

export function Tooltip({ label, side = 'top', multiline = false, children, className }: TooltipProps) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ top: side === 'top' ? r.top : r.bottom, left: r.left + r.width / 2 });
  };
  const hide = () => setPos(null);

  useEffect(() => {
    if (!pos) return;
    const onMove = () => setPos(null);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [pos]);

  return (
    <span
      ref={wrapRef}
      className={cn('inline-flex', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {pos &&
        createPortal(
          <span
            data-ui="tooltip"
            aria-hidden="true"
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              zIndex: 100,
              transform: side === 'top' ? 'translate(-50%, calc(-100% - 6px))' : 'translate(-50%, 6px)',
            }}
            className={cn(
              'pointer-events-none rounded-md border border-border bg-surfaceGlass px-2 py-1 text-xs font-medium text-textMain shadow-md backdrop-blur-md',
              multiline ? 'max-w-[20rem] whitespace-normal text-left' : 'whitespace-nowrap',
            )}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
