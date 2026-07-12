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
 * P1.2 — mobile primary navigation, iOS idiom (ROADMAP 1.2, policy §2
 * "Navigation"): a fixed bottom tab bar with UP TO 5 targets, each an icon
 * over a small label. The active target shows its FILLED glyph (`activeIcon`,
 * policy §3 "Active states") plus the tinted label.
 *
 * Semantics: a `<nav>` of buttons with `aria-current="page"` on the active
 * target — these switch top-level pages, they do not control an in-page
 * tabpanel, so `tablist` would be wrong. Keyboard: every target is a tab stop;
 * Arrow keys / Home / End also move focus along the bar (wrap-around);
 * Enter/Space activates. Focus ring on :focus-visible only.
 *
 * Overflow: more than 5 items auto-collapse to the first 4 + a trailing
 * "More" target (`data-more`) firing `onMore` — wire it to open the full nav
 * tree as a sheet. "More" lights up (`data-active`, no aria-current — it is
 * not a page) while the active key is hidden inside it.
 *
 * Variants (CSS only): the neutral default is a plain surface bar; iOS makes
 * it the HIG tab bar — 49pt targets on glass, hairline top, 10pt labels.
 * Material apps render `NavigationBar` instead (the app picks the composite).
 */

/** The 5-slot cap of the iOS tab bar (HIG) — more items collapse into "More". */
const MAX_TARGETS = 5;

export interface TabBarItem {
  key: string;
  label: string;
  /** Resting glyph. */
  icon: ReactNode;
  /** Filled glyph while active (policy §3); falls back to `icon`. */
  activeIcon?: ReactNode;
  onSelect: () => void;
}

export interface TabBarProps extends HTMLAttributes<HTMLElement> {
  items: TabBarItem[];
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

/** iOS "More" ellipsis — filled dots, so it also reads as the active glyph. */
function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-6 w-6">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

function itemClass(active: boolean): string {
  return cn(
    'flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs',
    'transition duration-base ease-smooth focus-visible:outline-none focus-visible:shadow-focus',
    active ? 'font-medium text-primary-600' : 'text-textMuted hover:text-textMain',
  );
}

export const TabBar = forwardRef<HTMLElement, TabBarProps>(function TabBar(
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
      innerRef.current?.querySelectorAll<HTMLButtonElement>('[data-ui="tab-bar-item"]') ?? [],
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
      data-ui="tab-bar"
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
            data-ui="tab-bar-item"
            data-key={item.key}
            data-active={active || undefined}
            aria-current={active ? 'page' : undefined}
            onClick={item.onSelect}
            onKeyDown={onKeyDown}
            className={itemClass(active)}
          >
            <span data-ui="tab-bar-icon" aria-hidden="true" className="flex h-6 w-6 items-center justify-center">
              {active && item.activeIcon ? item.activeIcon : item.icon}
            </span>
            <span data-ui="tab-bar-label" className="max-w-full truncate">
              {item.label}
            </span>
          </button>
        );
      })}
      {collapse && (
        <button
          type="button"
          data-ui="tab-bar-item"
          data-more=""
          data-active={moreActive || undefined}
          aria-haspopup="dialog"
          onClick={onMore}
          onKeyDown={onKeyDown}
          className={itemClass(moreActive)}
        >
          <span data-ui="tab-bar-icon" aria-hidden="true" className="flex h-6 w-6 items-center justify-center">
            {moreIcon ?? <MoreIcon />}
          </span>
          <span data-ui="tab-bar-label" className="max-w-full truncate">
            {moreLabel}
          </span>
        </button>
      )}
    </nav>
  );
});
