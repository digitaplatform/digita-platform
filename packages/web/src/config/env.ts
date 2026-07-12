import "server-only";
import { getLocales, getDefaultLocale } from "./locales";
import type { PublicSiteConfig } from "./public";

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

export interface ServerConfig extends PublicSiteConfig {
  /** Cluster-internal engine URL for server-side fetches (never sent to the browser). */
  engineUrl: string;
  revalidateSeconds: number;
  /** On-publish revalidation secret. Explicitly OPTIONAL: null → that feature is off. */
  revalidateSecret: string | null;
}

let cached: ServerConfig | null = null;

export function getConfig(): ServerConfig {
  if (cached) return cached;
  cached = {
    engineUrl: noTrailing(req("ENGINE_URL")),
    siteId: req("SITE_ID"),
    siteUrl: noTrailing(req("SITE_URL")),
    publicEngineUrl: noTrailing(reqDefined("PUBLIC_ENGINE_URL")),
    revalidateSeconds: reqInt("REVALIDATE_SECONDS"),
    revalidateSecret: process.env.REVALIDATE_SECRET || null,
    locales: getLocales(),
    defaultLocale: getDefaultLocale(),
  };
  return cached;
}

/** The browser-safe subset, injected into the client via <ConfigProvider>. */
export function publicConfig(): PublicSiteConfig {
  const c = getConfig();
  return {
    siteId: c.siteId,
    siteUrl: c.siteUrl,
    publicEngineUrl: c.publicEngineUrl,
    locales: c.locales,
    defaultLocale: c.defaultLocale,
  };
}
