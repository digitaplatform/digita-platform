import type { MetadataRoute } from "next";
import { listPages } from "@/lib/engine-client";
import { absoluteUrl, pageAlternates, pagePath } from "@/lib/seo";

// Dynamic: reads runtime config (SITE_URL) + live page list per request.
export const dynamic = "force-dynamic";

/** Sitemap of all published pages, with per-page hreflang alternates. A page list the engine does
 *  not answer fails the sitemap instead of emptying it: a crawler that reads an empty sitemap takes
 *  every page for gone. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const published = await listPages();

  // a page reads the alternates of its own translation group, not of the whole list
  const byGroup = new Map<string, typeof published>();
  for (const p of published) {
    if (!p.translation_group) continue;
    const arr = byGroup.get(p.translation_group) ?? [];
    arr.push(p);
    byGroup.set(p.translation_group, arr);
  }

  // A page marked no_index is not listed: its head tells crawlers to leave it out, so the sitemap
  // must not send them to it.
  return published
    .filter((p) => !p.no_index)
    .map((p) => ({
      url: absoluteUrl(pagePath(p.locale, p.slug)),
      lastModified: p.modified ? new Date(p.modified) : undefined,
      changeFrequency: "weekly" as const,
      priority: p.slug ? 0.7 : 1,
      alternates: { languages: pageAlternates(p, p.translation_group ? byGroup.get(p.translation_group) ?? [] : []) },
    }));
}
