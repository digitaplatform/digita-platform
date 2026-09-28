import { NextResponse, type NextRequest } from "next/server";
import { getLocales, getDefaultLocale } from "./config/locales";

/**
 * The URL rules. A www host moves to its apex host for good (301, the path kept). A path without
 * a locale is the default locale's page: it is rewritten to the locale route, so the address bar
 * keeps the bare URL (`/about` serves `/en/about`). A path with a locale passes. No negotiation:
 * one URL shows one language to every visitor and every crawler.
 */
export function middleware(req: NextRequest): NextResponse | undefined {
  const host = req.headers.get("host") ?? req.nextUrl.host;
  if (host.startsWith("www.")) {
    const url = req.nextUrl.clone();
    // The Host header names the port the visitor used, if any; the request URL carries the pod's.
    const [hostname = "", port = ""] = host.slice("www.".length).split(":");
    url.hostname = hostname;
    url.port = port;
    // Behind the ingress the request arrives as http; the visitor came over the forwarded protocol.
    const forwarded = req.headers.get("x-forwarded-proto");
    if (forwarded) url.protocol = `${forwarded}:`;
    return NextResponse.redirect(url, 301);
  }

  const { pathname } = req.nextUrl;
  const hasLocale = getLocales().some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
  if (hasLocale) return undefined;

  const url = req.nextUrl.clone();
  url.pathname = `/${getDefaultLocale()}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Everything except Next internals, the API, and files with an extension.
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
