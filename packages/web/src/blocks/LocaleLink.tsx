"use client";

import type { AnchorHTMLAttributes } from "react";
import { useParams } from "next/navigation";
import { useSiteConfig } from "@/config/ConfigProvider";
import { localeHref } from "@/lib/nav";

/** A link a block's content authored as a site path (`/catalog`), put into the locale of the page
 *  it stands on, so a visitor on a German page stays in German. A URL with a scheme and an anchor
 *  pass through. Blocks render on the server without the page's locale; the route knows it. */
export function LocaleLink({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const locale = useParams<{ locale?: string }>()?.locale;
  const { defaultLocale } = useSiteConfig();
  return <a href={locale ? localeHref(locale, defaultLocale, href) : href} {...props} />;
}
