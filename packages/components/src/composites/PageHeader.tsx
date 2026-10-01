import {
  forwardRef,
  isValidElement,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from 'react';
import { cn } from '../lib/cn.js';
import { findScrollContainer } from '../lib/find-scroll-container.js';

/**
 * P1.1 — page header with large title (ROADMAP 1.1, policy §2 "Title & back").
 *
 * Structure: a sticky compact BAR (back slot · aria-hidden title mirror ·
 * trailing actions) followed by the LARGE-TITLE block and an optional search
 * slot, both in normal flow. When the page scrolls, the large title slides
 * under the sticky bar naturally; the moment the header sticks, which is when
 * its bottom meets the bar's bottom and everything below the bar is under it,
 * the header flips `data-collapsed="true"` and the CSS cross-fades the large
 * title and the search slot ↔ bar mirror. The state is read from that
 * geometry on every scroll and resize, never from a stored scroll offset.
 * Nothing ever changes size — the collapse is pure opacity/transform, so it can
 * NEVER reflow the page or feed back into the scroll position (no flicker loop).
 *
 * Why the whole header is sticky: a sticky element never leaves its containing
 * block, so a bar sticky inside the header alone scrolls away with the header.
 * The header itself sticks at `--topbar-h` minus the height of everything below
 * the bar (`--page-header-rest-h`, measured here and set on the header), so once
 * the page has scrolled that far the header stands with its title block under
 * the top bar and exactly the bar's height showing; the bar, sticky at
 * `--topbar-h` inside it, is that visible band. The header is confined by its
 * own containing block, so a page renders it inside the element that spans the
 * whole page, not inside a toolbar. The bar's height is published as
 * `--page-header-bar-h` on the scroll container, so what pins under the bar
 * (a form's tab strip) reads it. A collapsed search slot is faded, not hidden:
 * it keeps its place in the tab order, and when it takes focus the header
 * scrolls its source to the top, where the header stands whole. A browser
 * scrolls a focused field into view from the field's current rect, and a stuck
 * header does not move with the scroll, so that scroll alone never frees it.
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
  /** A caption above the title: the kind of thing the page shows (its entity). */
  eyebrow?: ReactNode;
  /** Sits beside the heading, outside it: a record's status pill and lock marker. */
  status?: ReactNode;
  /** Stands before the heading in the title block, never in the bar: a record's picture. */
  media?: ReactNode;
  /** Search slot in the title area (policy §2 "Search"). */
  search?: ReactNode;
  /** Scroll source driving the collapse. Default: nearest scrollable ancestor
   *  of the header, else window. */
  scrollRef?: RefObject<HTMLElement | null>;
  /** Scroll offset (px) beyond which the header collapses. Default: none; the
   *  header collapses the moment it sticks, so the title block and the search
   *  slot fade only once the bar hides both. */
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
    eyebrow,
    status,
    media,
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
  const barRef = useRef<HTMLDivElement>(null);
  const scrollSourceRef = useRef<HTMLElement | Window | null>(null);
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

  useLayoutEffect(() => {
    const header = innerRef.current;
    const bar = barRef.current;
    if (!header || !bar) return;
    const scroller = scrollRef?.current ?? findScrollContainer(header);
    const source: HTMLElement | Window = scroller ?? window;
    scrollSourceRef.current = source;
    const barHeightTarget = scroller ?? document.documentElement;
    const offset = () => (source instanceof Window ? source.scrollY : source.scrollTop);
    // Stuck, the header shows exactly the bar: its bottom meets the bar's bottom, short of
    // a pixel because --page-header-rest-h is whole pixels and rects are fractional. Read
    // from the rects on every scroll, so the padding above the header and a width change
    // cannot put the state off. Where nothing is laid out (jsdom, display:none) every
    // rect is zero and the comparison holds at rest; then any offset collapses.
    const isStuck = () =>
      offset() > 0 && header.getBoundingClientRect().bottom - bar.getBoundingClientRect().bottom < 1;
    const track = () =>
      setScrollCollapsed(collapseThreshold === undefined ? isStuck() : offset() > collapseThreshold);
    // Inline properties, not state: a re-render for every resize would run layout twice.
    const measure = () => {
      header.style.setProperty('--page-header-rest-h', `${header.offsetHeight - bar.offsetHeight}px`);
      barHeightTarget.style.setProperty('--page-header-bar-h', `${bar.offsetHeight}px`);
      // A new rest height moves the header's sticky top, so the collapse state follows.
      if (!isControlled) track();
    };
    measure(); // also syncs the initial state (mount mid-scroll, e.g. route restore)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(header);
    observer?.observe(bar);
    if (!isControlled) source.addEventListener('scroll', track, { passive: true });
    return () => {
      observer?.disconnect();
      barHeightTarget.style.removeProperty('--page-header-bar-h');
      source.removeEventListener('scroll', track);
    };
  }, [isControlled, scrollRef, collapseThreshold]);

  // The header is the first thing on its page, so the top of the scroll content shows the
  // search whole; see the docblock for why the browser's own focus scroll cannot.
  const revealSearch = () => {
    const source = scrollSourceRef.current;
    if (!scrollCollapsed || !source) return;
    if (source instanceof Window) source.scrollTo(0, 0);
    else source.scrollTop = 0;
  };

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

  const barIsEmpty = !back && !actions && !collapsed;

  return (
    <header
      ref={setRefs}
      {...props}
      data-ui="page-header"
      data-collapsed={collapsed ? 'true' : 'false'}
      // Below the TopBar (z-30), above the grid's sticky header and a form's tab strip
      // (z-10). The theme sets --topbar-h for every design, so the 0 fallback holds only
      // where no theme is loaded.
      className={cn('sticky top-[calc(var(--topbar-h,0px)_-_var(--page-header-rest-h,0px))] z-20', className)}
    >
      <div
        ref={barRef}
        data-ui="page-header-bar"
        // Sticky inside the stuck header: pulled down from the header's top, which is
        // under the TopBar, to the band the header leaves visible. Without a back link and
        // actions the bar holds nothing until the header sticks, and its background would
        // stand as a blank band above the title; it keeps its height, so the collapse never
        // changes the header's size. data-empty names that state to a design that paints
        // the bar itself, whose rule outranks bg-transparent.
        data-empty={barIsEmpty ? 'true' : undefined}
        className={cn(
          'sticky top-[var(--topbar-h,0px)] z-20 flex min-h-12 items-center gap-2 px-3',
          barIsEmpty ? 'bg-transparent' : 'bg-surface',
        )}
      >
        {backNode}
        {/* A flex item in flow, not an absolute centered span: it shrinks and
            truncates before the actions, so it can never paint over them. */}
        <span
          data-ui="page-header-bar-title"
          aria-hidden="true"
          className="pointer-events-none min-w-0 flex-1 truncate text-center text-h2 text-textMain opacity-0 transition-opacity duration-base ease-smooth"
        >
          {title}
        </span>
        {actions && (
          // The slot wraps, so a page with many actions keeps every one reachable on a
          // phone instead of pushing the last ones past the edge of the bar. ml-auto
          // keeps it at the end where a design lets the mirror shrink to its text.
          <div data-ui="page-header-actions" className="ml-auto flex flex-wrap items-center justify-end gap-1">
            {actions}
          </div>
        )}
      </div>
      <div
        data-ui="page-header-title"
        className="min-w-0 px-4 pb-2 pt-1 transition-opacity duration-base ease-smooth"
      >
        {eyebrow != null && (
          <p data-ui="page-header-eyebrow" className="text-xs uppercase tracking-wide text-textMuted">
            {eyebrow}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {media != null && (
            <span data-ui="page-header-media" className="shrink-0">
              {media}
            </span>
          )}
          {/* The heading wraps: a record's title must be read whole, and the truncating
              mirror in the bar has no room for a tooltip. overflow-wrap breaks a title
              without a break opportunity (an email address), which would otherwise
              scroll the page sideways on a phone. One display font for every page
              title is the design intent. */}
          <HeadingTag
            data-ui="page-header-heading"
            className="min-w-0 text-balance text-h1 font-display text-textMain [overflow-wrap:anywhere]"
          >
            {title}
          </HeadingTag>
          {status != null && (
            <span data-ui="page-header-status" className="flex flex-wrap items-center gap-2">
              {status}
            </span>
          )}
        </div>
      </div>
      {search && (
        // Fades with the title block and stays in the tab order; see the docblock.
        <div
          data-ui="page-header-search"
          onFocus={revealSearch}
          className="px-4 pb-3 transition-opacity duration-base ease-smooth"
        >
          {search}
        </div>
      )}
    </header>
  );
});
