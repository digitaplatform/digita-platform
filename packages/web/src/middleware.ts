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
 * with a locale passes and shows its language to every visitor and crawler. The bare URL may
 * redirect a browser to its own language: the page decides that, from the header set here.
 */
export function middleware(req: NextRequest): NextResponse {
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

  // Only this middleware marks a request negotiable: a header the client sent would let a
  // prefixed URL redirect, so it is dropped before any route reads it.
  const headers = new Headers(req.headers);
  headers.delete("x-locale-negotiable");
  // The API and files with an extension (sitemap.xml, robots.txt) are no locale's pages.
  const { pathname, search } = req.nextUrl;
  const isPage = !/^\/(api(\/|$)|.*\.)/.test(pathname);
  const hasLocale = getLocales().some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
  if (!isPage || hasLocale) return NextResponse.next({ request: { headers } });

  const url = req.nextUrl.clone();
  url.pathname = `/${getDefaultLocale()}${pathname === "/" ? "" : pathname}`;
  // The page redirects a browser that prefers another published locale to that locale's URL of
  // the path named here, its query kept. Page or redirect, the bare URL's answer depends on the
  // browser's language and the locale cookie, so every cache keeps them apart.
  headers.set("x-locale-negotiable", `${pathname}${search}`);
  return NextResponse.rewrite(url, { request: { headers }, headers: { vary: "Accept-Language, Cookie" } });
}

export const config = {
  // Every path but Next's own assets: the host rule holds for the API and the files too.
  matcher: ["/((?!_next/).*)"],
};
