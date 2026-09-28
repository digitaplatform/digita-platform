import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { offeredLocales, preferredLocale } from "@/config/locales";
import { getConfig } from "@/config/env";
import { getSite, listPublishedSlugs } from "@/lib/engine-client";
import { localePath, pathSlug } from "@/lib/nav";

/**
 * Sends a bare URL's visitor to their own language, or returns. A bare URL is the default
 * locale's page for every crawler, so one URL indexes one language and stays the x-default; only
 * a browser that prefers another locale in which this page is published moves to that locale's
 * URL of the same page, the query kept. The visitor's own pick in the language menu, the locale
 * cookie, stands in for the browser's list; a cookie naming a locale this page does not offer is
 * ignored. Every page calls this, not the layout: Next keeps a layout across a soft navigation,
 * so a redirect decided there would miss every link click.
 */
export async function negotiateLocale(locale: string): Promise<void> {
  const negotiable = (await headers()).get("x-locale-negotiable");
  if (!negotiable) return;
  // The middleware writes the visitor's path and query as one value; the host is not part of it.
  const { pathname, search } = new URL(negotiable, "http://negotiable");
  const config = getConfig();
  const [site, publishedSlugs] = await Promise.all([getSite(), listPublishedSlugs()]);
  const enabledLocales = (site?.enabled_locales ?? []).filter(Boolean);
  // The mark carries the path percent-encoded; the published slugs are stored decoded.
  const slug = pathSlug(decodeURIComponent(pathname), config.locales);
  const offered = offeredLocales(config.locales, publishedSlugs, enabledLocales, slug, locale);
  const picked = (await cookies()).get("locale")?.value;
  const asked = picked && offered.includes(picked) ? picked : ((await headers()).get("accept-language") ?? "");
  const preferred = preferredLocale(asked, offered, config.defaultLocale);
  if (preferred) redirect(`${localePath(preferred, config.defaultLocale, pathname)}${search}`);
}
