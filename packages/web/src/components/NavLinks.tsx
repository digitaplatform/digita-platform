"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navLeafClass } from "@digitaplatform/components";
import type { NavItem } from "@/lib/types";
import { navHref } from "@/lib/nav";

/** Whether `href` is the current page: home matches exactly, other items match the page or any of
 *  its sub-paths. */
export function isActiveHref(pathname: string, href: string, homeHref: string): boolean {
  return href === homeHref ? pathname === homeHref : pathname === href || pathname.startsWith(href + "/");
}

/**
 * Header nav links, styled as the app's nav items (the kit's navLeafClass), with an ACTIVE state
 * for the current page. Client-side because it needs the current path (the Header is
 * server-rendered in the layout and can't know the active page). The tenant's apps follow as
 * plain links: each one leaves the website for the app at `/<name>/` on the same host.
 */
export function NavLinks({ locale, items, apps }: { locale: string; items: NavItem[]; apps: string[] }) {
  const pathname = usePathname();
  const homeHref = `/${locale}`;

  return (
    <>
      {items.map((item, i) => {
        const href = navHref(locale, item);
        const active = isActiveHref(pathname, href, homeHref);
        return (
          <Link key={`${item.label}-${i}`} href={href} aria-current={active ? "page" : undefined} data-ui="nav-leaf" className={navLeafClass(active)}>
            {item.label}
          </Link>
        );
      })}
      {apps.map((app) => (
        <a key={app} href={`/${app}/`} data-ui="nav-leaf" className={navLeafClass(false)}>
          {app}
        </a>
      ))}
    </>
  );
}
