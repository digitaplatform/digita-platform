"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/types";
import { navHref } from "@/lib/nav";

const LINK = "rounded-full px-3 py-1.5 text-sm font-medium text-textMuted transition-colors hover:bg-bgHover hover:text-textMain";

/**
 * Header nav links with an ACTIVE state for the current page. Client-side because
 * it needs the current path (the Header is server-rendered in the layout and
 * can't know the active page). Home matches exactly; other items match the page
 * or any of its sub-paths. The tenant's apps follow as plain links: each one leaves the website
 * for the app at `/<name>/` on the same host.
 */
export function NavLinks({ locale, items, apps }: { locale: string; items: NavItem[]; apps: string[] }) {
  const pathname = usePathname();
  const homeHref = `/${locale}`;

  return (
    <>
      {items.map((item, i) => {
        const href = navHref(locale, item);
        const active =
          href === homeHref ? pathname === homeHref : pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={`${item.label}-${i}`}
            href={href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "rounded-full bg-primary-50 px-3 py-1.5 text-sm font-semibold text-primary-600"
                : LINK
            }
          >
            {item.label}
          </Link>
        );
      })}
      {apps.map((app) => (
        <a key={app} href={`/${app}/`} className={LINK}>
          {app}
        </a>
      ))}
    </>
  );
}
