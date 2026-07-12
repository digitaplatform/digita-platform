import type { Metadata } from "next";
import { getConfig } from "@/config/env";
import type { WebPage, WebSite } from "./types";
import { listPages } from "./engine-client";
import { mediaUrl } from "./media";

export function pagePath(locale: string, slug: string): string {
  return slug ? `/${locale}/${slug}` : `/${locale}`;
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

/** Build Next metadata for a page incl. canonical, hreflang siblings, and OG. */
export async function buildPageMetadata(page: WebPage, site: WebSite | null): Promise<Metadata> {
  const path = pagePath(page.locale, page.slug);
  const title = page.meta_title || page.title;
  const description = page.meta_description;
  const image = ogImageUrl(page.og_image || site?.default_og_image);

  const languages: Record<string, string> = {};
  if (page.translation_group) {
    const all = await listPages();
    for (const p of all) {
      if (p.translation_group === page.translation_group) {
        languages[p.locale] = absoluteUrl(pagePath(p.locale, p.slug));
      }
    }
  }
  languages["x-default"] = absoluteUrl(path);

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
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

/** Minimal WebPage JSON-LD for richer search results. */
export function pageJsonLd(page: WebPage, site: WebSite | null): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: page.meta_title || page.title,
    description: page.meta_description,
    inLanguage: page.locale,
    url: absoluteUrl(pagePath(page.locale, page.slug)),
    isPartOf: site ? { "@type": "WebSite", name: site.site_name, url: getConfig().siteUrl } : undefined,
  });
}
