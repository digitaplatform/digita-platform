import { getConfig } from "@/config/env";
import type { WebSite, WebPage, WebNavMenu, WebBranding } from "./types";
import type { ContactRequest } from "./contact-request";

/**
 * Server-side client for the engine's GENERIC public read API
 * (/api/v1/public/resource/*) and its public create of a contact request.
 * Fetched cluster-internally; never sends a token (Guest read and create).
 * ISR-cached with tags so the on-publish revalidation webhook can purge precisely. Always scopes to this deployment's SITE_ID and
 * requests only published rows. All config is strict runtime env (no fallbacks),
 * read per-request via getConfig().
 */

/** This deployment's site id (strict env). */
export function siteId(): string {
  return getConfig().siteId;
}

type Tuple = [string, string, unknown];

type QueryParams = { filters?: Tuple[]; fields?: string[]; page_size?: number; page?: number; order_by?: string };

/** One page of a public list and the number of pages the engine counts for the whole list. */
async function queryPage<T>(doctype: string, params: QueryParams, tags: string[]): Promise<{ rows: T[]; totalPages: number }> {
  const { engineUrl, revalidateSeconds } = getConfig();
  const qs = new URLSearchParams();
  if (params.filters) qs.set("filters", JSON.stringify(params.filters));
  if (params.fields) qs.set("fields", JSON.stringify(params.fields));
  if (params.page_size) qs.set("page_size", String(params.page_size));
  if (params.page) qs.set("page", String(params.page));
  if (params.order_by) qs.set("order_by", params.order_by);
  const url = `${engineUrl}/api/v1/public/resource/${doctype}?${qs.toString()}`;
  const none = { rows: [], totalPages: 0 };
  try {
    const res = await fetch(url, { next: { revalidate: revalidateSeconds, tags } });
    if (!res.ok) return none;
    const json = (await res.json()) as { data?: T[]; meta?: { total_pages?: number } };
    if (!Array.isArray(json.data)) return none;
    return { rows: json.data, totalPages: json.meta?.total_pages ?? 0 };
  } catch {
    return none; // engine unreachable (e.g. transient) → render gracefully, no fake data
  }
}

async function query<T>(doctype: string, params: QueryParams, tags: string[]): Promise<T[]> {
  return (await queryPage<T>(doctype, params, tags)).rows;
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
  // The engine clamps page_size to its own ceiling, so the loop stops on the page count it answers, not on
  // a short page. A unique order keeps offset paging from skipping or repeating a row that shares its sort value.
  // Each engine page re-checks every matching row before it slices, so listing N rows costs about N * N / 200 read checks.
  const pages: WebPage[] = [];
  for (let page = 1; ; page++) {
    const { rows, totalPages } = await queryPage<WebPage>(
      "WebPage",
      {
        filters,
        fields: ["_id", "slug", "locale", "title", "translation_group", "modified"],
        page_size: 200,
        page,
        order_by: "_id asc",
      },
      [`web:pages:${site}`],
    );
    pages.push(...rows);
    if (page >= totalPages) return pages;
  }
}

/** The published pages per locale, as slugs, for the language menu (offeredLocales says why).
 *  This entry and a page's own entry expire on their own TTLs, so for up to REVALIDATE_SECONDS
 *  after a publish the two can disagree. */
export async function listPublishedSlugs(): Promise<Record<string, string[]>> {
  const slugs: Record<string, string[]> = {};
  for (const page of await listPages()) (slugs[page.locale] ??= []).push(page.slug);
  return slugs;
}

export async function getNav(locale: string, location: WebNavMenu["location"]): Promise<WebNavMenu | null> {
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

/** The tenant branding of this site's engine, from its anonymous boot. Null when the engine
 *  cannot answer: the page then renders in the signature's identity alone, and the log says why. */
export async function getBranding(): Promise<WebBranding | null> {
  const { engineUrl, revalidateSeconds } = getConfig();
  try {
    const res = await fetch(`${engineUrl}/api/v1/boot`, {
      next: { revalidate: revalidateSeconds, tags: ["web:branding"] },
    });
    if (!res.ok) {
      console.error(`[digita-web] boot answered HTTP ${res.status}; rendering without tenant branding`);
      return null;
    }
    const json = (await res.json()) as { data?: { branding?: WebBranding } };
    return json.data?.branding ?? null;
  } catch (err) {
    console.error("[digita-web] boot unreachable; rendering without tenant branding:", err);
    return null;
  }
}

/** Stores one contact request on the engine through its public create route, without a
 *  credential: the engine takes it because ContactRequest grants Guest create. Answers the
 *  engine's status, so the route can tell a refused create from a failure. The engine trusts
 *  this server as its one proxy hop and limits the route per visitor, so the visitor's address
 *  travels as the one X-Forwarded-For entry; without it every visitor of the site would share
 *  the renderer's own budget. */
export async function createContactRequest(request: ContactRequest, visitorAddress: string): Promise<number> {
  const res = await fetch(`${getConfig().engineUrl}/api/v1/public/resource/ContactRequest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": visitorAddress },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(5000),
  });
  return res.status;
}
