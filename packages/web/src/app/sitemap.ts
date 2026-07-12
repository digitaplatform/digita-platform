import type { MetadataRoute } from "next";
import { listPages } from "@/lib/engine-client";
import { absoluteUrl, pagePath } from "@/lib/seo";

// Dynamic: reads runtime config (SITE_URL) + live page list per request.
export const dynamic = "force-dynamic";

/** Sitemap of all published pages, with per-page hreflang alternates. Returns
 *  empty (valid) if the engine is unreachable. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = await listPages();

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
