import type { NavItem } from "./types";

/**
 * Resolve a nav item to an href. An explicit `href` wins (absolute URLs pass
 * through; relative paths get the locale prefix). Otherwise `page` is a WebPage
 * `_id` of the form `site::locale::slug` — we link to `/<locale>/<slug>` (home
 * = empty slug → `/<locale>`).
 */
export function navHref(locale: string, item: NavItem): string {
  if (item.href) {
    if (/^https?:\/\//.test(item.href) || item.href.startsWith("#")) return item.href;
    const path = item.href.startsWith("/") ? item.href : `/${item.href}`;
    return `/${locale}${path}`;
  }
  if (item.page) {
    const parts = item.page.split("::");
    const pageLocale = parts[1] || locale;
    const slug = parts[2] ?? "";
    return slug ? `/${pageLocale}/${slug}` : `/${pageLocale}`;
  }
  return `/${locale}`;
}

export function sortNav(items: NavItem[] | undefined): NavItem[] {
  return [...(items ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
