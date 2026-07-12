"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/types";
import { navHref } from "@/lib/nav";

/**
 * Header nav links with an ACTIVE state for the current page. Client-side because
 * it needs the current path (the Header is server-rendered in the layout and
 * can't know the active page). Home matches exactly; other items match the page
 * or any of its sub-paths.
 */
export function NavLinks({ locale, items }: { locale: string; items: NavItem[] }) {
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
                ? "rounded-full bg-primary-soft px-3 py-1.5 text-sm font-semibold text-primary"
                : "rounded-full px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:bg-hover hover:text-fg"
            }
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
