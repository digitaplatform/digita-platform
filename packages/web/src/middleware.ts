import { NextResponse, type NextRequest } from "next/server";
import { getLocales, getDefaultLocale } from "./config/locales";

/** The host the site answers on: the host of SITE_URL. Read at call time, as the locales are. */
function canonicalHostname(): string {
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) throw new Error("[digita-web] missing required env var: SITE_URL");
  return new URL(siteUrl).hostname;
}

/**
 * The URL rules. A host that differs from the canonical host (SITE_URL's) only by a leading
 * "www." moves to the canonical host for good (301, path and query kept), on every path; any other
 * host is left alone. A page path without a locale is the default locale's page: it is rewritten
 * to the locale route, so the address bar keeps the bare URL (`/about` serves `/en/about`). A path
 * with a locale passes. No negotiation: one URL shows one language to every visitor and crawler.
 */
export function middleware(req: NextRequest): NextResponse | undefined {
  const host = req.headers.get("host") ?? req.nextUrl.host;
  // The Host header names the port the visitor used, if any; the request URL carries the pod's.
  const [hostname = "", port = ""] = host.split(":");
  const canonical = canonicalHostname();
  if (hostname !== canonical && (hostname === `www.${canonical}` || `www.${hostname}` === canonical)) {
    const url = req.nextUrl.clone();
    url.hostname = canonical;
    url.port = port;
    // Behind the ingress the request arrives as http; the visitor came over the forwarded protocol.
    const forwarded = req.headers.get("x-forwarded-proto");
    if (forwarded) url.protocol = `${forwarded}:`;
    return NextResponse.redirect(url, 301);
  }

  // The API and files with an extension (sitemap.xml, robots.txt) are no locale's pages.
  const { pathname } = req.nextUrl;
  if (/^\/(api(\/|$)|.*\.)/.test(pathname)) return undefined;
  const hasLocale = getLocales().some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
  if (hasLocale) return undefined;

  const url = req.nextUrl.clone();
  url.pathname = `/${getDefaultLocale()}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Every path but Next's own assets: the host rule holds for the API and the files too.
  matcher: ["/((?!_next/).*)"],
};
