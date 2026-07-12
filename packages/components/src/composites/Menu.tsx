import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Popover } from '../primitives/Popover.js';

const ITEM_SELECTOR = '[role="menuitem"],[role="menuitemradio"]';

export interface MenuProps {
  /** Accessible name for the menu and its trigger. */
  label: string;
  /** Content of the trigger button (icons/text). */
  trigger: ReactNode;
  /** Menu body; `close` dismisses the menu (call it from an item's onSelect). */
  children: (close: () => void) => ReactNode;
  /** Panel horizontal alignment relative to the trigger. */
  align?: 'start' | 'end';
  /** Extra classes for the trigger button. */
  triggerClassName?: string;
  /** Extra classes for the panel (e.g. a width like `w-60`). */
  panelClassName?: string;
}

/**
 * Generic dropdown menu — a trigger button plus a `role="menu"` panel. Owns the
 * open state, Escape-to-close (restoring focus to the trigger), pointer-outside
 * close, focus-first-item on open, and roving arrow-key focus over the items. The
 * single home for every dropdown menu (account menu, density picker, row menus);
 * domain-agnostic — the caller supplies the trigger content and the items (via
 * [[MenuItem]]). No icon library dependency.
 */
export function Menu({
  label,
  trigger,
  children,
  align = 'end',
  triggerClassName,
  panelClassName,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    // Land focus on the first item so keyboard users enter the menu.
    panelRef.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Consume: stopPropagation for same-phase listeners AND preventDefault
        // so a host BaseDialog (bubble phase) knows the Escape was used here.
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      // The panel is PORTALED (Popover) — clicks inside it are not "outside".
      if (rootRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const onPanelKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    if (items.length === 0) return;
    e.preventDefault();
    const cur = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (e.key === 'ArrowDown') next = cur < 0 ? 0 : Math.min(cur + 1, items.length - 1);
    else if (e.key === 'ArrowUp') next = cur < 0 ? items.length - 1 : Math.max(cur - 1, 0);
    else if (e.key === 'Home') next = 0;
    else next = items.length - 1;
    items[next]?.focus();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {/* Portaled via Popover (never clipped); Menu keeps its own Escape/outside
          handling — the Popover only provides portal + positioning here. */}
      <Popover
        open={open}
        anchorRef={rootRef}
        onRequestClose={() => setOpen(false)}
        align={align}
        closeOnEscape={false}
        closeOnOutsidePointer={false}
        className="rounded-dialog shadow-lg"
      >
        <div
          ref={panelRef}
          data-ui="menu"
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onPanelKeyDown}
          className={cn('py-1.5', panelClassName)}
        >
          {children(close)}
        </div>
      </Popover>
    </div>
  );
}

export interface MenuItemProps {
  onSelect: () => void;
  children: ReactNode;
  /** Leading icon node (ignored when `checked` is provided). */
  icon?: ReactNode;
  danger?: boolean;
  /** When provided, the item is a radio item with a leading check column. */
  checked?: boolean;
  /**
   * Inert item: `aria-disabled` + no onSelect, but still FOCUSABLE (APG menu
   * pattern) so keyboard users can reach it and read why (wrap in a Tooltip).
   */
  disabled?: boolean;
  className?: string;
}

function CheckMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M5 10.5l3.5 3.5L15 6.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** One row in a [[Menu]] — a `menuitem`, or a `menuitemradio` when `checked` is set. */
export function MenuItem({ onSelect, children, icon, danger, checked, disabled, className }: MenuItemProps) {
  const radio = checked !== undefined;
  return (
    <button
      type="button"
      data-ui="menu-item"
      role={radio ? 'menuitemradio' : 'menuitem'}
      aria-checked={radio ? checked : undefined}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onSelect}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors duration-base ease-smooth focus:bg-bgHover focus:outline-none',
        disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-bgHover',
        danger ? 'text-error' : 'text-textMain',
        className,
      )}
    >
      {radio ? (
        <CheckMark
          className={cn('h-4 w-4 shrink-0 text-primary-600', checked ? 'opacity-100' : 'opacity-0')}
        />
      ) : icon ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="truncate">{children}</span>
    </button>
  );
}
