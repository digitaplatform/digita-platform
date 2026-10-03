import type { NavItem, WebNavMenu, WebPage } from "./types";

/** The URL of a site path in `locale`. The default locale's pages live at the bare path; the
 *  middleware rewrites it to the locale route. Every other locale lives under /<locale>. */
export function localePath(locale: string, defaultLocale: string, path = ""): string {
  const bare = path === "/" ? "" : path && !path.startsWith("/") ? `/${path}` : path;
  if (locale === defaultLocale) return bare || "/";
  return `/${locale}${bare}`;
}

/** An authored href in `locale`: a URL with a scheme (https:, mailto:, tel:) and an anchor pass
 *  through; a site path is put into the locale. */
export function localeHref(locale: string, defaultLocale: string, href: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("//")) return href;
  return localePath(locale, defaultLocale, href);
}

/** Whether an href leaves this site: a web link opens in a new tab. */
export function isExternalHref(href: string): boolean {
  return /^https?:\/\//.test(href);
}

/** The same path in another locale, from the path the browser shows. */
/** The segments of a pathname after its locale prefix, if it has one. */
function segmentsAfterLocale(pathname: string, locales: string[]): string[] {
  const [, first = "", ...rest] = pathname.split("/");
  return locales.includes(first) ? rest : [first, ...rest];
}

export function switchLocalePath(pathname: string, next: string, locales: string[], defaultLocale: string): string {
  return localePath(next, defaultLocale, `/${segmentsAfterLocale(pathname, locales).join("/")}`);
}

/** The page slug a pathname names, without its locale prefix: "" for a home page. */
export function pathSlug(pathname: string, locales: string[]): string {
  return segmentsAfterLocale(pathname, locales).join("/").replace(/\/+$/, "");
}

/**
 * Resolve a nav item to an href, or null when the item links nowhere (a product still coming).
 * An explicit `href` wins. Otherwise `page` is a WebPage `_id` of the form `site::locale::slug`.
 */
export function navHref(locale: string, defaultLocale: string, item: NavItem): string | null {
  if (item.href) return localeHref(locale, defaultLocale, item.href);
  if (item.page) {
    const [, pageLocale, slug = ""] = item.page.split("::");
    return localePath(pageLocale || locale, defaultLocale, slug);
  }
  return null;
}

/**
 * The menu a visitor sees in `locale`, built from the active nodes of a site's menu tree: children
 * under their `parent`, siblings by `position`, then `label`. A node that links a page takes the
 * published page of the same `translation_group` in `locale`; where there is none, the node is not
 * drawn, nor is a heading whose children are all left out. A node with only `href` is drawn in every
 * language. A node whose parent is not among `nodes` (an inactive one) is not drawn.
 */
export function buildNavTree(
  nodes: WebNavMenu[],
  pages: Pick<WebPage, "_id" | "locale" | "translation_group">[],
  locale: string,
): NavItem[] {
  const pageById = new Map(pages.map((page) => [page._id, page]));
  const pageIn = (id: string): string | undefined => {
    const page = pageById.get(id);
    if (!page) return undefined;
    if (page.locale === locale) return page._id;
    if (!page.translation_group) return undefined;
    return pages.find((p) => p.translation_group === page.translation_group && p.locale === locale)?._id;
  };
  const childrenOf = new Map<string | null, WebNavMenu[]>();
  for (const node of nodes) {
    if (!Object.hasOwn(node, "parent") || typeof node.label !== "string") continue;
    const parent = node.parent || null;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), node]);
  }
  const siblingOrder = (a: WebNavMenu, b: WebNavMenu) => (a.position ?? 0) - (b.position ?? 0) || a.label.localeCompare(b.label);
  const build = (parent: string | null): NavItem[] =>
    [...(childrenOf.get(parent) ?? [])].sort(siblingOrder).flatMap((node): NavItem[] => {
      const children = build(node._id);
      if (childrenOf.has(node._id)) return children.length ? [{ label: node.label, ...(node.icon ? { icon: node.icon } : {}), children }] : [];
      const item: NavItem = { label: node.label };
      if (node.icon) item.icon = node.icon;
      if (node.href) item.href = node.href;
      if (node.page) {
        const page = pageIn(node.page);
        if (!page) return [];
        item.page = page;
      }
      return [item];
    });
  return build(null);
}

/** A menu's entries in the order a list draws them: each heading, then what lies under it. */
export type MenuEntry = { heading: string } | { item: NavItem };

export function menuEntries(items: NavItem[]): MenuEntry[] {
  return items.flatMap((item): MenuEntry[] => (item.children ? [{ heading: item.label }, ...menuEntries(item.children)] : [{ item }]));
}

/** Filter leaves before flattening, removing headings whose children all disappear. */
export function filterNavItems(items: NavItem[], keep: (item: NavItem) => boolean): NavItem[] {
  return items.flatMap((item): NavItem[] => {
    if (!item.children) return keep(item) ? [item] : [];
    const children = filterNavItems(item.children, keep);
    return children.length ? [{ ...item, children }] : [];
  });
}

/** The href of a menu item that stands for the contact sheet. No element of a page is its anchor,
 *  so as a plain link the item would lead nowhere. */
const CONTACT_HREF = "#contact";

/** Whether a menu item stands for the contact sheet rather than for a page. */
export function isContactItem(item: NavItem): boolean {
  return item.href === CONTACT_HREF;
}
