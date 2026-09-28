import type { NavItem } from "./types";

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
export function switchLocalePath(pathname: string, next: string, locales: string[], defaultLocale: string): string {
  const [, first = "", ...rest] = pathname.split("/");
  const path = locales.includes(first) ? `/${rest.join("/")}` : pathname;
  return localePath(next, defaultLocale, path);
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

export function sortNav(items: NavItem[] | undefined): NavItem[] {
  return [...(items ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
