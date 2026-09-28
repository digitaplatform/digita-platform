"use client";

import { usePathname } from "next/navigation";
import { navLeafClass } from "@digitaplatform/components";
import { useSiteConfig } from "@/config/ConfigProvider";
import type { NavItem } from "@/lib/types";
import { localePath, navHref } from "@/lib/nav";
import { NavItemLink } from "./NavItemLink";

/** Whether `href` is the current page: home matches exactly, other items match the page or any of
 *  its sub-paths. */
export function isActiveHref(pathname: string, href: string | null, homeHref: string): boolean {
  if (!href) return false;
  return href === homeHref ? pathname === homeHref : pathname === href || pathname.startsWith(href + "/");
}

/** Which of `items` is the page the visitor is on, by the path the browser shows. */
export function useActiveItem(locale: string): (item: NavItem) => boolean {
  const pathname = usePathname();
  const { defaultLocale } = useSiteConfig();
  const homeHref = localePath(locale, defaultLocale);
  return (item) => isActiveHref(pathname, navHref(locale, defaultLocale, item), homeHref);
}

/**
 * Header nav links, styled as the app's nav items (the kit's navLeafClass), with an ACTIVE state
 * for the current page. Client-side because it needs the current path (the Header is
 * server-rendered in the layout and can't know the active page). The tenant's apps follow as
 * plain links: each one leaves the website for the app at `/<name>/` on the same host.
 */
export function NavLinks({ locale, items, apps, comingLabel }: { locale: string; items: NavItem[]; apps: string[]; comingLabel: string }) {
  const isActive = useActiveItem(locale);

  return (
    <>
      {items.map((item, i) => {
        const active = isActive(item);
        return (
          <NavItemLink
            key={`${item.label}-${i}`}
            locale={locale}
            item={item}
            comingLabel={comingLabel}
            current={active}
            data-ui="nav-leaf"
            className={navLeafClass(active)}
          />
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
