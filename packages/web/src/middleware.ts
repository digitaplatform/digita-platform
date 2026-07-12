import { NextResponse, type NextRequest } from "next/server";
import { getLocales, getDefaultLocale, LOCALE_COOKIE } from "./config/locales";

/** Redirect locale-less paths to a negotiated locale (`/` → `/en`, `/about` →
 *  `/en/about`). Priority: a manually-chosen NEXT_LOCALE cookie → the browser's
 *  Accept-Language → the platform default. Locales come from runtime env. */
export function middleware(req: NextRequest): NextResponse | undefined {
  const { pathname } = req.nextUrl;
  const locales = getLocales();

  const hasLocale = locales.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
  if (hasLocale) return undefined;

  // Manual choice wins (set by the LocaleSwitcher) so it survives a return to a
  // locale-less URL; otherwise auto-detect from the browser.
  const cookie = req.cookies.get(LOCALE_COOKIE)?.value;
  const accepted = (req.headers.get("accept-language") ?? "")
    .split(",")
    .map((part) => part.split(";")[0]?.trim().slice(0, 2).toLowerCase() ?? "");
  const locale =
    (cookie && locales.includes(cookie) ? cookie : undefined) ??
    accepted.find((p) => locales.includes(p)) ??
    getDefaultLocale();

  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next internals, the API, and files with an extension.
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
