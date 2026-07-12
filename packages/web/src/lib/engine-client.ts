import { getConfig } from "@/config/env";
import type { WebSite, WebPage, WebNavMenu } from "./types";

/**
 * Server-side client for the engine's GENERIC public read API
 * (/api/v1/public/resource/*). Fetched cluster-internally; never exposes a
 * token (Guest read). ISR-cached with tags so the on-publish revalidation
 * webhook can purge precisely. Always scopes to this deployment's SITE_ID and
 * requests only published rows. All config is strict runtime env (no fallbacks),
 * read per-request via getConfig().
 */

/** This deployment's site id (strict env). */
export function siteId(): string {
  return getConfig().siteId;
}

type Tuple = [string, string, unknown];

async function query<T>(
  doctype: string,
  params: { filters?: Tuple[]; fields?: string[]; page_size?: number },
  tags: string[],
): Promise<T[]> {
  const { engineUrl, revalidateSeconds } = getConfig();
  const qs = new URLSearchParams();
  if (params.filters) qs.set("filters", JSON.stringify(params.filters));
  if (params.fields) qs.set("fields", JSON.stringify(params.fields));
  if (params.page_size) qs.set("page_size", String(params.page_size));
  const url = `${engineUrl}/api/v1/public/resource/${doctype}?${qs.toString()}`;
  try {
    const res = await fetch(url, { next: { revalidate: revalidateSeconds, tags } });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: T[] };
    return Array.isArray(json.data) ? json.data : [];
  } catch {
    return []; // engine unreachable (e.g. transient) → render gracefully, no fake data
  }
}

export async function getSite(): Promise<WebSite | null> {
  const site = siteId();
  const rows = await query<WebSite>("WebSite", { filters: [["_id", "=", site]], page_size: 1 }, [
    `web:site:${site}`,
  ]);
  return rows[0] ?? null;
}

export async function getPage(locale: string, slug: string): Promise<WebPage | null> {
  const site = siteId();
  const rows = await query<WebPage>(
    "WebPage",
    {
      filters: [
        ["site", "=", site],
        ["locale", "=", locale],
        ["slug", "=", slug],
        ["status", "=", "published"],
      ],
      page_size: 1,
    },
    [`web:page:${site}:${locale}:${slug}`],
  );
  return rows[0] ?? null;
}

export async function listPages(locale?: string): Promise<WebPage[]> {
  const site = siteId();
  const filters: Tuple[] = [
    ["site", "=", site],
    ["status", "=", "published"],
  ];
  if (locale) filters.push(["locale", "=", locale]);
  return query<WebPage>(
    "WebPage",
    {
      filters,
      fields: ["_id", "slug", "locale", "nav_label", "title", "translation_group", "modified"],
      page_size: 200,
    },
    [`web:pages:${site}`],
  );
}

export async function getNav(locale: string, location: "header" | "footer"): Promise<WebNavMenu | null> {
  const site = siteId();
  const rows = await query<WebNavMenu>(
    "WebNavMenu",
    {
      filters: [
        ["site", "=", site],
        ["locale", "=", locale],
        ["location", "=", location],
        ["status", "=", "published"],
      ],
      page_size: 1,
    },
    [`web:nav:${site}:${locale}`],
  );
  return rows[0] ?? null;
}
