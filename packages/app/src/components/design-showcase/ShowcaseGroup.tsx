import { createContext, useContext, useEffect, useState, type ReactNode, type RefObject } from 'react';

const GROUP_SELECTOR = '[data-showcase-group]';

/** The data-ui hooks each showcase group has rendered, keyed by group title. */
const HookReadoutContext = createContext<Record<string, string[]>>({});
export const HookReadoutProvider = HookReadoutContext.Provider;

function addHooks(node: Element, into: Set<string>): void {
  const own = node.getAttribute('data-ui');
  if (own) into.add(own);
  node.querySelectorAll('[data-ui]').forEach((el) => into.add(el.getAttribute('data-ui')!));
}

/**
 * Collects, per showcase group, every data-ui hook the group has rendered since
 * the page mounted. A group's own subtree is read directly. The kit portals its
 * overlays (dialog, popover, menu, tooltip, toast, fab) to <body>, outside every
 * group, so a body-level node belongs to the group the reviewer last pointed at,
 * focused or typed in when the node appeared. The sets only grow, so a dialog's
 * hooks stay listed after it closes.
 */
export function useHookReadouts(pageRef: RefObject<HTMLElement | null>): Record<string, string[]> {
  const [readouts, setReadouts] = useState<Record<string, string[]>>({});

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const seen = new Map<string, Set<string>>();
    // A body-level node present before the first interaction has no owner we can
    // name; '' marks it so a later interaction never claims it.
    const owners = new WeakMap<Element, string>();
    let current = '';
    const hooksOf = (group: string) => {
      let hooks = seen.get(group);
      if (!hooks) seen.set(group, (hooks = new Set()));
      return hooks;
    };

    const collect = () => {
      page.querySelectorAll<HTMLElement>(GROUP_SELECTOR).forEach((group) => {
        addHooks(group, hooksOf(group.dataset.showcaseGroup!));
      });
      for (const node of Array.from(document.body.children)) {
        if (node.contains(page)) continue;
        if (!owners.has(node)) owners.set(node, current);
        const owner = owners.get(node);
        if (owner) addHooks(node, hooksOf(owner));
      }
      const next = Object.fromEntries([...seen].map(([group, hooks]) => [group, [...hooks].sort()]));
      // Only a real change re-renders; the readout's own text change must not loop.
      setReadouts((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };

    // The app's own tree (shell and page); every other body-level node is an overlay.
    const appRoot = Array.from(document.body.children).find((node) => node.contains(page)) ?? page;
    // An event inside an open overlay leaves the owner as it is, so a popover
    // opened from inside a dialog still belongs to the dialog's group; one in the
    // app shell outside every group (the top bar's palette) belongs to none.
    const track = (e: Event) => {
      if (!(e.target instanceof Element) || !appRoot.contains(e.target)) return;
      current = e.target.closest<HTMLElement>(GROUP_SELECTOR)?.dataset.showcaseGroup ?? '';
    };
    const events = ['pointerdown', 'pointerover', 'focusin', 'keydown'] as const;
    for (const type of events) document.addEventListener(type, track, true);
    const observer = new MutationObserver(collect);
    observer.observe(document.body, { childList: true, subtree: true });
    collect();
    return () => {
      observer.disconnect();
      for (const type of events) document.removeEventListener(type, track, true);
    };
  }, [pageRef]);

  return readouts;
}

/**
 * One component group of the showcase: its title, the kit exports it renders
 * and, beside them, the data-ui hooks read from the rendered DOM. The frame is
 * plain markup, never a kit component, so it adds no hook of its own.
 */
export function ShowcaseGroup({
  title,
  exports,
  children,
}: {
  title: string;
  /** The kit exports this group renders, as the kit's index names them. */
  exports: string[];
  children: ReactNode;
}) {
  const hooks = useContext(HookReadoutContext)[title] ?? [];
  return (
    <section
      data-showcase-group={title}
      data-showcase-exports={exports.join(' ')}
      className="min-w-0 space-y-3 rounded-card border border-border p-4"
    >
      <header className="space-y-1">
        <h3 className="text-sm font-semibold text-textMain">{title}</h3>
        <p className="font-mono text-xs text-textMuted">
          <span className="font-sans">data-ui: </span>
          <output>{hooks.length > 0 ? hooks.join(' · ') : '—'}</output>
        </p>
      </header>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </section>
  );
}

/** One state of a component, captioned with the state's name. */
export function ShowcaseState({ state, children }: { state: string; children: ReactNode }) {
  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <div>{children}</div>
      <figcaption className="text-micro uppercase tracking-wide text-textMuted">{state}</figcaption>
    </figure>
  );
}

/**
 * Opens a component the kit portals to <body> or docks to the viewport. Plain
 * markup, never a kit Button, so the group's hook readout stays the component's.
 * `aria-expanded`, when given, says whether the overlay is open.
 */
export function ShowcaseOpener({
  open,
  onToggle,
  children,
  buttonRef,
}: {
  open?: boolean;
  onToggle: () => void;
  children: ReactNode;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      data-showcase-opener=""
      aria-expanded={open}
      onClick={onToggle}
      className="rounded-btn border border-dashed border-borderStrong px-3 py-1.5 text-xs text-textMuted hover:text-textMain"
    >
      {children}
    </button>
  );
}

/**
 * A frame that becomes the containing block of the `position: fixed` bars the
 * kit docks to the viewport edge (tab bar, navigation bar), so they render
 * inside the gallery instead of over the page.
 */
export function ShowcaseViewport({ children }: { children: ReactNode }) {
  return <div className="relative h-24 w-80 overflow-hidden rounded-card border border-border [transform:translateZ(0)]">{children}</div>;
}
