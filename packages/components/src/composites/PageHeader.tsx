import {
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from 'react';
import { cn } from '../lib/cn.js';

/**
 * P1.1 — page header with large title (ROADMAP 1.1, policy §2 "Title & back").
 *
 * Structure: a sticky compact BAR (back slot · aria-hidden title mirror ·
 * trailing actions) followed by the LARGE-TITLE block and an optional search
 * slot, both in normal flow. When the page scrolls, the large title slides
 * under the sticky bar naturally; past the collapse threshold the header flips
 * `data-collapsed="true"` and the CSS cross-fades large title ↔ bar mirror.
 * Nothing ever changes size — the collapse is pure opacity/transform, so it can
 * NEVER reflow the page or feed back into the scroll position (no flicker loop).
 *
 * Collapse source: `scrollRef` if given, else the nearest scrollable ancestor,
 * else window. A controlled `collapsed` prop overrides tracking entirely
 * (SSR, tests, custom drivers).
 *
 * Accessibility: the title renders exactly ONCE as a heading (default <h1>);
 * the compact mirror in the bar is `aria-hidden`, so screen readers always hear
 * a single heading regardless of the collapse state (the large title fades via
 * opacity — it never leaves the accessibility tree). The built-in back button
 * carries `aria-label` = the previous page's title, so its name survives the
 * Material layer hiding the text label.
 *
 * Variants (CSS only): iOS = 34pt bold large title → 17pt centered bar title,
 * glass bar with an on-scroll hairline; Material = medium top app bar
 * (headline-small row → leading title-large), bar tint surface → subtle on
 * scroll — both keyed on the same [data-collapsed] hook.
 */

/** Built-in back affordance — `label` is the PREVIOUS page's title (policy §3). */
export interface PageHeaderBackAction {
  label: string;
  onClick: () => void;
}

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Page title — rendered once as the accessible heading. */
  title: ReactNode;
  /** Heading level of the title (default 1 — one PageHeader per page). */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Leading slot: `{ label, onClick }` renders the kit back button (‹ chevron +
   *  previous title; Material swaps it to the ← arrow icon button via CSS); a
   *  ReactNode renders as-is so router links keep working. */
  back?: PageHeaderBackAction | ReactNode;
  /** Trailing bar actions (IconButtons, menus, …). */
  actions?: ReactNode;
  /** Search slot in the title area (policy §2 "Search"). */
  search?: ReactNode;
  /** Scroll source driving the collapse. Default: nearest scrollable ancestor
   *  of the header, else window. */
  scrollRef?: RefObject<HTMLElement | null>;
  /** Scroll offset (px) beyond which the header collapses. Default: the
   *  measured height of the large-title block. */
  collapseThreshold?: number;
  /** Controlled collapse state — overrides scroll tracking entirely. */
  collapsed?: boolean;
}

function isBackAction(back: PageHeaderProps['back']): back is PageHeaderBackAction {
  return (
    typeof back === 'object' &&
    back !== null &&
    !isValidElement(back) &&
    'label' in back &&
    'onClick' in back
  );
}

/** Nearest ancestor that actually scrolls vertically (the default collapse source). */
function findScrollContainer(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return p;
  }
  return null;
}

/** iOS back chevron — shown by default; the Material layer hides it. */
function BackChevronIcon() {
  return (
    <svg
      data-ui="page-header-back-chevron"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-5 w-5 shrink-0"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

/** M3 back arrow — hidden by default; the Material layer opts it in. */
function BackArrowIcon() {
  return (
    <svg
      data-ui="page-header-back-arrow"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="hidden h-5 w-5 shrink-0"
    >
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

export const PageHeader = forwardRef<HTMLElement, PageHeaderProps>(function PageHeader(
  {
    title,
    headingLevel = 1,
    back,
    actions,
    search,
    scrollRef,
    collapseThreshold,
    collapsed: collapsedProp,
    className,
    ...props
  },
  ref,
) {
  const innerRef = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const [scrollCollapsed, setScrollCollapsed] = useState(false);
  const isControlled = collapsedProp !== undefined;
  const collapsed = collapsedProp ?? scrollCollapsed;

  const setRefs = useCallback(
    (node: HTMLElement | null) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as MutableRefObject<HTMLElement | null>).current = node;
    },
    [ref],
  );

  useEffect(() => {
    if (isControlled) return;
    const header = innerRef.current;
    if (!header) return;
    const source: HTMLElement | Window = scrollRef?.current ?? findScrollContainer(header) ?? window;
    // Measured once per bind: past the large title's own height it is fully
    // under the bar. Unmeasurable (jsdom, display:none) → any offset collapses.
    const threshold = collapseThreshold ?? Math.max(titleRef.current?.offsetHeight ?? 0, 1);
    const offset = () => (source instanceof Window ? source.scrollY : source.scrollTop);
    const onScroll = () => setScrollCollapsed(offset() > threshold);
    onScroll(); // sync the initial state (mount mid-scroll, e.g. route restore)
    source.addEventListener('scroll', onScroll, { passive: true });
    return () => source.removeEventListener('scroll', onScroll);
  }, [isControlled, scrollRef, collapseThreshold]);

  const HeadingTag = `h${headingLevel}` as `h${typeof headingLevel}`;

  const backNode = isBackAction(back) ? (
    <button
      type="button"
      data-ui="page-header-back"
      aria-label={back.label}
      onClick={back.onClick}
      className="flex min-w-0 shrink items-center gap-0.5 rounded-btn px-1.5 py-1 text-sm text-textMain transition duration-base ease-smooth hover:bg-bgHover focus-visible:outline-none focus-visible:shadow-focus"
    >
      <BackChevronIcon />
      <BackArrowIcon />
      <span data-ui="page-header-back-label" className="truncate">
        {back.label}
      </span>
    </button>
  ) : (
    back
  );

  return (
    <header
      ref={setRefs}
      {...props}
      data-ui="page-header"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn('relative', className)}
    >
      <div
        data-ui="page-header-bar"
        className="sticky top-0 z-30 flex min-h-12 items-center gap-2 bg-surface px-3"
      >
        {backNode}
        <span
          data-ui="page-header-bar-title"
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 max-w-[55%] -translate-x-1/2 truncate text-h2 text-textMain opacity-0 transition-opacity duration-base ease-smooth"
        >
          {title}
        </span>
        <span className="flex-1" aria-hidden="true" />
        {actions && (
          <div data-ui="page-header-actions" className="flex shrink-0 items-center gap-1">
            {actions}
          </div>
        )}
      </div>
      <div
        ref={titleRef}
        data-ui="page-header-title"
        className="min-w-0 px-4 pb-2 pt-1 transition-opacity duration-base ease-smooth"
      >
        <HeadingTag data-ui="page-header-heading" className="truncate text-h1 text-textMain">
          {title}
        </HeadingTag>
      </div>
      {search && (
        <div data-ui="page-header-search" className="px-4 pb-3">
          {search}
        </div>
      )}
    </header>
  );
});
