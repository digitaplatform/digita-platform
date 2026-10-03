import type { Metadata } from "next";
import { getConfig } from "@/config/env";
import type { WebPage, WebSite } from "./types";
import { listPages } from "./engine-client";
import { mediaUrl } from "./media";
import { jsonForScript } from "./json-script";
import { localePath } from "./nav";

/** A page's path: bare in the default locale, under /<locale> in the others. */
export function pagePath(locale: string, slug: string): string {
  return localePath(locale, getConfig().defaultLocale, slug);
}

/** Absolute URL on this deployment's canonical host (strict env SITE_URL). */
export function absoluteUrl(path: string): string {
  return `${getConfig().siteUrl}${path}`;
}

function ogImageUrl(ref: string | undefined): string | undefined {
  const url = mediaUrl(ref);
  if (!url) return undefined;
  return url.startsWith("http") ? url : absoluteUrl(url);
}

/** The pages a page's hreflang alternates are read from. */
type AlternateSource = Pick<WebPage, "slug" | "locale" | "translation_group" | "no_index">;

/** The hreflang alternates of a page: its translations that crawlers may index, itself, and
 *  x-default, which is the default locale's URL, the bare one, which the middleware serves without
 *  negotiation. The page head and the sitemap entry both read them here, so one page never names
 *  two sets. No other page names a translation marked no_index, because a crawler sent there finds
 *  a page the site asked it to leave out. `published` may hold pages of other groups; they are skipped. */
export function pageAlternates(page: AlternateSource, published: readonly AlternateSource[]): Record<string, string> {
  const languages: Record<string, string> = {};
  if (page.translation_group) {
    for (const p of published) {
      if (p.translation_group === page.translation_group && !p.no_index) {
        languages[p.locale] = absoluteUrl(pagePath(p.locale, p.slug));
      }
    }
  }
  languages[page.locale] = absoluteUrl(pagePath(page.locale, page.slug));
  const bare = languages[getConfig().defaultLocale];
  if (bare) languages["x-default"] = bare;
  return languages;
}

/** Build Next metadata for a page incl. canonical, hreflang alternates, and OG. */
export async function buildPageMetadata(page: WebPage, site: WebSite | null): Promise<Metadata> {
  const path = pagePath(page.locale, page.slug);
  const title = page.meta_title || page.title;
  const description = page.meta_description;
  // A page or site that names its own image keeps it; every other page shows the one drawn for it.
  const image =
    ogImageUrl(page.og_image || site?.default_og_image) ??
    absoluteUrl(`/api/og?${new URLSearchParams({ locale: page.locale, slug: page.slug })}`);

  const languages = pageAlternates(page, page.translation_group ? await listPages() : []);

  return {
    title,
    description,
    metadataBase: new URL(getConfig().siteUrl),
    alternates: { canonical: page.canonical_url || absoluteUrl(path), languages },
    robots: page.no_index ? { index: false, follow: false } : undefined,
    openGraph: {
      title,
      description,
      url: absoluteUrl(path),
      siteName: site?.site_name,
      locale: page.locale,
      type: "website",
      images: [{ url: image }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

/** Minimal WebPage JSON-LD for richer search results. */
export function pageJsonLd(page: WebPage, site: WebSite | null): string {
  return jsonForScript({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: page.meta_title || page.title,
    description: page.meta_description,
    inLanguage: page.locale,
    url: absoluteUrl(pagePath(page.locale, page.slug)),
    isPartOf: site ? { "@type": "WebSite", name: site.site_name, url: getConfig().siteUrl } : undefined,
  });
}
