import { entityCacheTag } from "@digitaplatform/shared";
import { getConfig } from "@/config/env";
import type { WebSite, WebPage, WebNavMenu, WebBranding } from "./types";

/**
 * Server-side client for the engine's GENERIC public read API
 * (/api/v1/public/resource/*) and the public create of any engine the site's forms post to.
 * Fetched cluster-internally; never sends a token (Guest read and create).
 * ISR-cached under the tag of the entity read, which the engine posts to /api/revalidate after a save. Always scopes to this deployment's SITE_ID and
 * requests only published rows. All config is strict runtime env (no fallbacks),
 * read per-request via getConfig().
 */

/** This deployment's site id (strict env). */
export function siteId(): string {
  return getConfig().siteId;
}

type Tuple = [string, string, unknown];

type QueryParams = { filters?: Tuple[]; fields?: string[]; page_size?: number; page?: number; order_by?: string };

/** Logs why an engine read failed and returns the error that ends the request. A failed read must
 *  not pass for a list without rows, which every caller would answer as a missing page. */
function logFailedRead(doctype: string, what: string, cause?: unknown): Error {
  const line = `[digita-web] ${doctype} read ${what}`;
  if (cause === undefined) {
    console.error(line);
    return new Error(line);
  }
  console.error(line, cause);
  return new Error(line, { cause });
}

/** One page of a public list and the number of pages the engine counts for the whole list. A read
 *  the engine does not answer with a list throws: an outage is not an empty site. */
async function queryPage<T>(doctype: string, params: QueryParams): Promise<{ rows: T[]; totalPages: number }> {
  const { engineUrl, revalidateSeconds } = getConfig();
  const qs = new URLSearchParams();
  if (params.filters) qs.set("filters", JSON.stringify(params.filters));
  if (params.fields) qs.set("fields", JSON.stringify(params.fields));
  if (params.page_size) qs.set("page_size", String(params.page_size));
  if (params.page) qs.set("page", String(params.page));
  if (params.order_by) qs.set("order_by", params.order_by);
  const url = `${engineUrl}/api/v1/public/resource/${doctype}?${qs.toString()}`;
  let res: Response;
  try {
    res = await fetch(url, { next: { revalidate: revalidateSeconds, tags: [entityCacheTag(doctype)] } });
  } catch (err) {
    throw logFailedRead(doctype, "could not reach the engine", err);
  }
  if (!res.ok) throw logFailedRead(doctype, `answered HTTP ${res.status}`);
  let json: { data?: T[]; meta?: { total_pages?: number } } | null;
  try {
    json = await res.json();
  } catch (err) {
    throw logFailedRead(doctype, "answered a body that is no JSON", err);
  }
  const rows = json?.data;
  if (!Array.isArray(rows)) throw logFailedRead(doctype, "answered no list");
  return { rows, totalPages: json?.meta?.total_pages ?? 0 };
}

async function query<T>(doctype: string, params: QueryParams): Promise<T[]> {
  return (await queryPage<T>(doctype, params)).rows;
}

export async function getSite(): Promise<WebSite | null> {
  const site = siteId();
  const rows = await query<WebSite>("WebSite", { filters: [["_id", "=", site]], page_size: 1 });
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
        fields: ["_id", "slug", "locale", "title", "translation_group", "modified", "no_index"],
        page_size: 200,
        page,
        order_by: "_id asc",
      },
    );
    pages.push(...rows);
    if (page >= totalPages) return pages;
  }
}

/** The published pages per locale, as slugs, for the language menu (offeredLocales says why).
 *  This entry and a page's own entry carry the same tag, so a save purges both. When the engine's
 *  post does not arrive, each expires on its own TTL, and for up to REVALIDATE_SECONDS the two can
 *  disagree. */
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
  );
  return rows[0] ?? null;
}

/** How long a page waits for an engine's anonymous boot. Next caches only a successful answer, so
 *  an engine that hangs would otherwise hold every page of the site. */
const BOOT_TIMEOUT_MS = 5000;

/** The tenant branding of this site's engine, from its anonymous boot. Null when the engine
 *  cannot answer: the page then renders in the signature's identity alone, and the log says why. */
export async function getBranding(): Promise<WebBranding | null> {
  const { engineUrl, revalidateSeconds } = getConfig();
  try {
    const res = await fetch(`${engineUrl}/api/v1/boot`, {
      next: { revalidate: revalidateSeconds, tags: ["web:branding"] },
      signal: AbortSignal.timeout(BOOT_TIMEOUT_MS),
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

/**
 * The website look the tenant's settings name: `BrandingSetting.web_default_signature` of the
 * tenant's apps (ENGINE_URLS), read from each app's anonymous boot. Site engines have no staff
 * app, so in practice the one app a person administers names it. Apps that name a look must
 * agree: when they name different ones, none is used and the log names them. An app that does not
 * answer is logged and left out. Undefined: no app names one.
 */
export async function findWebsiteSignature(): Promise<string | undefined> {
  const { engineUrls, revalidateSeconds } = getConfig();
  const named = new Map<string, string>();
  await Promise.all(
    [...engineUrls].map(async ([app, engineUrl]) => {
      try {
        const res = await fetch(`${engineUrl}/api/v1/boot`, {
          next: { revalidate: revalidateSeconds, tags: ["web:branding"] },
          signal: AbortSignal.timeout(BOOT_TIMEOUT_MS),
        });
        if (!res.ok) {
          console.error(`[digita-web] the boot of app "${app}" answered HTTP ${res.status}; its website look is left out`);
          return;
        }
        const json = (await res.json()) as { data?: { branding?: { web_default_signature?: string } } };
        const look = json.data?.branding?.web_default_signature;
        if (look) named.set(app, look);
      } catch (err) {
        console.error(`[digita-web] the boot of app "${app}" is unreachable; its website look is left out:`, err);
      }
    }),
  );
  const looks = new Set(named.values());
  if (looks.size > 1) {
    // The apps answer in any order, so they are named in sorted order: one disagreement then reads
    // the same on every request, and since every request renders the layout, it is logged once.
    const which = [...named]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([app, look]) => `${app}: ${look}`)
      .join(", ");
    if (which !== loggedDisagreement) {
      console.error(`[digita-web] the tenant's apps name different website looks (${which}); none is used`);
      loggedDisagreement = which;
    }
    return undefined;
  }
  return [...looks][0];
}

let loggedDisagreement = "";

/** The engine's answer to a public create: its status, the error code of a refusal, the field a 400
 *  names and the wait it asks of a visitor over its budget. */
export interface CreateAnswer {
  status: number;
  code?: string;
  /** The field of the engine's error, or of its first message that names one. */
  field?: string;
  /** Seconds, from the Retry-After header of a 429. */
  retryAfter?: number;
}

/** Stores one record on an engine through its public create route, without a credential: the
 *  engine takes it when the entity grants Guest create, and refuses a field its Guest row does not
 *  let Guest set. Answers the engine's status and code, so a route can tell a refused create from
 *  a failure. The engine trusts this server as its one proxy hop and limits the route per visitor,
 *  so the visitor's address travels as the one X-Forwarded-For entry; without it every visitor of
 *  the site would share the renderer's own budget. */
export async function createRecord(
  engineUrl: string,
  entity: string,
  values: object,
  visitorAddress: string,
): Promise<CreateAnswer> {
  const res = await fetch(`${engineUrl}/api/v1/public/resource/${encodeURIComponent(entity)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": visitorAddress },
    body: JSON.stringify(values),
    signal: AbortSignal.timeout(5000),
  });
  if (res.ok) return { status: res.status };
  const body = (await res.json().catch(() => null)) as { error?: { code?: unknown; field?: unknown }; messages?: { path?: unknown }[] } | null;
  const messages = body?.messages;
  const messagePath = Array.isArray(messages) ? messages.map((message) => message.path).find((path) => typeof path === "string") : undefined;
  const wait = Number(res.headers.get("Retry-After"));
  return {
    status: res.status,
    code: typeof body?.error?.code === "string" ? body.error.code : undefined,
    field: typeof body?.error?.field === "string" ? body.error.field : typeof messagePath === "string" ? messagePath : undefined,
    retryAfter: Number.isInteger(wait) && wait > 0 ? wait : undefined,
  };
}
