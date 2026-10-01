import "server-only";
import { getLocales, getDefaultLocale } from "./locales";
import type { PublicSiteConfig } from "./public";
import type { WebSite } from "@/lib/types";

/**
 * Strict runtime config. Single source of truth; NO fallbacks — every value comes
 * from env and a missing one fails loud (so a misconfigured deploy can't silently
 * run against the wrong engine/site). Read LAZILY (getConfig) + cached, so
 * `next build` — which has no runtime env — never evaluates it; only requests do.
 * "server-only" guards the engine-internal URL + secret from ever reaching the
 * client bundle; the browser gets the public subset via <ConfigProvider>.
 */
function req(key: string): string {
  const v = process.env[key];
  if (v === undefined || v === "") throw new Error(`[digita-web] missing required env var: ${key}`);
  return v;
}
/** Required to be SET, but may be empty (e.g. PUBLIC_ENGINE_URL="" = same-origin). */
function reqDefined(key: string): string {
  const v = process.env[key];
  if (v === undefined) throw new Error(`[digita-web] missing required env var: ${key} (set it; may be empty)`);
  return v;
}
function reqInt(key: string): number {
  const v = req(key);
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`[digita-web] env var ${key} must be a non-negative integer, got "${v}"`);
  }
  return n;
}
const noTrailing = (u: string): string => u.replace(/\/+$/, "");

/**
 * The engines of the tenant's apps by app name, from ENGINE_URLS: a JSON object of app to that
 * app's cluster-internal engine URL, which the chart renders from the tenant's apps. Unset means
 * none beside ENGINE_URL. A value that is not such an object fails every request and names the
 * variable, so a form never posts to an engine nobody declared. A Map, so an app named
 * "__proto__" is only a name.
 */
export function parseEngineUrls(raw: string | undefined): ReadonlyMap<string, string> {
  const urls = new Map<string, string>();
  if (raw === undefined || raw === "") return urls;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("[digita-web] ENGINE_URLS must be a JSON object of app to engine URL");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("[digita-web] ENGINE_URLS must be a JSON object of app to engine URL");
  }
  for (const [app, url] of Object.entries(parsed)) {
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
      throw new Error(`[digita-web] ENGINE_URLS names app "${app}" without an http(s) URL`);
    }
    urls.set(app, noTrailing(url));
  }
  return urls;
}

export interface ServerConfig extends Omit<PublicSiteConfig, "contactEnabled" | "notFound"> {
  /** Cluster-internal engine URL for server-side fetches (never sent to the browser). */
  engineUrl: string;
  /** The engines of the tenant's apps (ENGINE_URLS, parseEngineUrls): a record form may post to
   *  them, and their settings may name the website look (findWebsiteSignature). Explicitly
   *  OPTIONAL: a site without one posts only to its own engine and draws its own look. */
  engineUrls: ReadonlyMap<string, string>;
  revalidateSeconds: number;
  /** The secret the engine sends with a cache purge (REVALIDATE_SECRET). */
  revalidateSecret: string;
  /** The tenant's apps the header links to (TENANT_APPS, comma separated). Explicitly OPTIONAL:
   *  a site that is no tenant's entry has none. */
  tenantApps: string[];
  /** The tenant IdP's public base URL (AUTH_URL), where the page refreshes a signed-in
   *  visitor's expired session before it asks an app for their design. Explicitly OPTIONAL:
   *  null → no refresh, so a visitor whose access cookie expired sees the default. */
  authUrl: string | null;
  /** Whether the tenant is a demo (DEMO_TENANT, "true" or "1" as the tenant's engines read it),
   *  whose IdP signs a visitor in as its demo user with one click. Explicitly OPTIONAL: off when
   *  unset. */
  demoTenant: boolean;
  /** The tenant's session cookie suffix (AUTH_COOKIE_SUFFIX, sessionCookieNames). Explicitly
   *  OPTIONAL: null → the unsuffixed names. */
  authCookieSuffix: string | null;
  /** The key the record forms of the site are signed with (FORM_SIGNING_KEY, src/lib/form-signature.ts),
   *  so a post is bound to a form the site placed. Known to this server alone and never printed.
   *  Explicitly OPTIONAL here: a page that places a record form fails without it, and the record
   *  route refuses every post. */
  formSigningKey: string | null;
  /** The site's chrome texts, one <language>.json each (TRANSLATIONS_DIR): the folder digita-web
   *  of digitaplatform/digita-translations, put there by the pod's init container. */
  translationsDir: string;
}

let cached: ServerConfig | null = null;

export function getConfig(): ServerConfig {
  if (cached) return cached;
  cached = {
    engineUrl: noTrailing(req("ENGINE_URL")),
    engineUrls: parseEngineUrls(process.env.ENGINE_URLS),
    siteId: req("SITE_ID"),
    siteUrl: noTrailing(req("SITE_URL")),
    publicEngineUrl: noTrailing(reqDefined("PUBLIC_ENGINE_URL")),
    revalidateSeconds: reqInt("REVALIDATE_SECONDS"),
    revalidateSecret: req("REVALIDATE_SECRET"),
    tenantApps: (process.env.TENANT_APPS ?? "").split(",").map((name) => name.trim()).filter(Boolean),
    authUrl: process.env.AUTH_URL ? noTrailing(process.env.AUTH_URL) : null,
    demoTenant: process.env.DEMO_TENANT === "true" || process.env.DEMO_TENANT === "1",
    authCookieSuffix: process.env.AUTH_COOKIE_SUFFIX || null,
    formSigningKey: process.env.FORM_SIGNING_KEY || null,
    translationsDir: req("TRANSLATIONS_DIR"),
    locales: getLocales(),
    defaultLocale: getDefaultLocale(),
  };
  return cached;
}

/** The record forms' signing key, for a page that places one: without it the page fails, as it does
 *  without any other setting it needs. */
export function requiredFormSigningKey(): string {
  const key = getConfig().formSigningKey;
  if (!key) throw new Error("[digita-web] missing required env var: FORM_SIGNING_KEY (a page places a record form)");
  return key;
}

/** The browser-safe subset, injected into the client via <ConfigProvider>. The contact sheet is
 *  offered when the site names the address its requests go to; the engine stores them and the
 *  web app's hook mails that address. */
export function publicConfig(site: WebSite | null, notFound: PublicSiteConfig["notFound"]): PublicSiteConfig {
  const c = getConfig();
  return {
    notFound,
    siteId: c.siteId,
    siteUrl: c.siteUrl,
    publicEngineUrl: c.publicEngineUrl,
    locales: c.locales,
    defaultLocale: c.defaultLocale,
    contactEnabled: Boolean(site?.contact_email),
  };
}
