import {
  forwardRef,
  useCallback,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { cn } from '../lib/cn.js';

/**
 * P1.2 — mobile primary navigation, Material 3 idiom (ROADMAP 1.2, policy §2
 * "Navigation"): the M3 navigation bar. Same items API as `TabBar` (ONE data
 * source feeds both; the app picks the composite per design variant). Each
 * target stacks the icon inside an INDICATOR slot over the label; the active
 * target fills the indicator as the secondary-container pill and bumps the
 * label to weight 500 (policy §3 "Active states").
 *
 * Semantics: a `<nav>` of buttons with `aria-current="page"` on the active
 * target (page switcher, not a tabpanel controller). Keyboard: every target is
 * a tab stop; Arrow keys / Home / End also move focus (wrap-around);
 * Enter/Space activates. Focus ring on :focus-visible only.
 *
 * Overflow: M3 caps the bar at 5 destinations too — more items collapse to
 * the first 4 + a "More" target (`data-more`) firing `onMore` (full tree as a
 * sheet). "More" lights up (`data-active`, no aria-current) while the active
 * key is hidden inside it.
 *
 * Variants (CSS only): the neutral default is a plain surface bar with the
 * kit's soft active pill; Material makes it the spec bar — 80dp targets on
 * surface-container tint, 64×32 secondary-container pill, label-medium.
 */

/** M3 navigation bars hold 3–5 destinations — more items collapse into "More". */
const MAX_TARGETS = 5;

export interface NavigationBarItem {
  key: string;
  label: string;
  /** Resting glyph. */
  icon: ReactNode;
  /** Filled glyph while active (policy §3); falls back to `icon`. */
  activeIcon?: ReactNode;
  onSelect: () => void;
}

export interface NavigationBarProps extends HTMLAttributes<HTMLElement> {
  items: NavigationBarItem[];
  /** Key of the current page's target — gets `aria-current="page"`. */
  activeKey?: string;
  /** Fired by the auto-collapsed "More" target (only rendered with >5 items).
   *  Open the full navigation tree as a sheet here. */
  onMore?: () => void;
  /** Label of the collapsed target (default "More"). */
  moreLabel?: string;
  /** Glyph of the collapsed target (default ••• ellipsis). */
  moreIcon?: ReactNode;
}

/** "More" ellipsis — filled dots, so it also reads as the active glyph. */
function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-6 w-6">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

function itemClass(): string {
  return cn(
    'group flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs text-textMuted',
    'transition duration-base ease-smooth hover:text-textMain focus-visible:outline-none focus-visible:shadow-focus',
  );
}

function ItemContent({ active, icon, label }: { active: boolean; icon: ReactNode; label: string }) {
  return (
    <>
      <span
        data-ui="nav-bar-indicator"
        aria-hidden="true"
        className={cn(
          'flex h-8 w-16 max-w-full items-center justify-center rounded-full transition duration-base ease-smooth',
          active && 'bg-bgHover text-textMain',
        )}
      >
        {icon}
      </span>
      <span data-ui="nav-bar-label" className={cn('max-w-full truncate', active && 'font-medium text-textMain')}>
        {label}
      </span>
    </>
  );
}

export const NavigationBar = forwardRef<HTMLElement, NavigationBarProps>(function NavigationBar(
  {
    items,
    activeKey,
    onMore,
    moreLabel = 'More',
    moreIcon,
    'aria-label': ariaLabel = 'Primary',
    className,
    ...props
  },
  ref,
) {
  const innerRef = useRef<HTMLElement | null>(null);

  const setRefs = useCallback(
    (node: HTMLElement | null) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as MutableRefObject<HTMLElement | null>).current = node;
    },
    [ref],
  );

  const collapse = items.length > MAX_TARGETS;
  const visible = collapse ? items.slice(0, MAX_TARGETS - 1) : items;
  const overflow = collapse ? items.slice(MAX_TARGETS - 1) : [];
  const moreActive = overflow.some((item) => item.key === activeKey);

  /** Arrow / Home / End move focus along the bar (wrap-around). */
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const targets = Array.from(
      innerRef.current?.querySelectorAll<HTMLButtonElement>('[data-ui="nav-bar-item"]') ?? [],
    );
    const idx = targets.indexOf(e.currentTarget);
    if (idx < 0) return;
    let next: number;
    if (e.key === 'ArrowRight') next = (idx + 1) % targets.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + targets.length) % targets.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = targets.length - 1;
    else return;
    e.preventDefault();
    targets[next]?.focus();
  };

  return (
    <nav
      ref={setRefs}
      {...props}
      aria-label={ariaLabel}
      data-ui="nav-bar"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]',
        className,
      )}
    >
      {visible.map((item) => {
        const active = item.key === activeKey;
        return (
          <button
            key={item.key}
            type="button"
            data-ui="nav-bar-item"
            data-key={item.key}
            data-active={active || undefined}
            aria-current={active ? 'page' : undefined}
            onClick={item.onSelect}
            onKeyDown={onKeyDown}
            className={itemClass()}
          >
            <ItemContent
              active={active}
              icon={active && item.activeIcon ? item.activeIcon : item.icon}
              label={item.label}
            />
          </button>
        );
      })}
      {collapse && (
        <button
          type="button"
          data-ui="nav-bar-item"
          data-more=""
          data-active={moreActive || undefined}
          aria-haspopup="dialog"
          onClick={onMore}
          onKeyDown={onKeyDown}
          className={itemClass()}
        >
          <ItemContent active={moreActive} icon={moreIcon ?? <MoreIcon />} label={moreLabel} />
        </button>
      )}
    </nav>
  );
});
