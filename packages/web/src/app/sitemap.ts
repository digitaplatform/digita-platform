import type { MetadataRoute } from "next";
import { listPages } from "@/lib/engine-client";
import { absoluteUrl, pagePath } from "@/lib/seo";

// Dynamic: reads runtime config (SITE_URL) + live page list per request.
export const dynamic = "force-dynamic";

/** Sitemap of all published pages, with per-page hreflang alternates. A page list the engine does
 *  not answer fails the sitemap instead of emptying it: a crawler that reads an empty sitemap takes
 *  every page for gone. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // A page marked no_index is neither listed nor named as an alternate: its head tells crawlers to
  // leave it out, so the sitemap must not send them to it.
  const pages = (await listPages()).filter((p) => !p.no_index);

  // group siblings by translation_group for hreflang alternates
  const byGroup = new Map<string, typeof pages>();
  for (const p of pages) {
    if (!p.translation_group) continue;
    const arr = byGroup.get(p.translation_group) ?? [];
    arr.push(p);
    byGroup.set(p.translation_group, arr);
  }

  return pages.map((p) => {
    const siblings = p.translation_group ? byGroup.get(p.translation_group) ?? [] : [];
    const languages: Record<string, string> = {};
    for (const s of siblings) languages[s.locale] = absoluteUrl(pagePath(s.locale, s.slug));

    return {
      url: absoluteUrl(pagePath(p.locale, p.slug)),
      lastModified: p.modified ? new Date(p.modified) : undefined,
      changeFrequency: "weekly" as const,
      priority: p.slug ? 0.7 : 1,
      alternates: Object.keys(languages).length ? { languages } : undefined,
    };
  });
}
