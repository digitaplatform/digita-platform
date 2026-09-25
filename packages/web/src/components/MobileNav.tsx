"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { BrandMark, Drawer, NavList, navLeafClass, railButtonClass, topBarButtonClass, type BrandMarkProps } from "@digitaplatform/components";
import type { NavItem } from "@/lib/types";
import { navHref } from "@/lib/nav";
import { isActiveHref } from "./NavLinks";

/**
 * Mobile navigation — the phone counterpart to the desktop NavLinks, which is `hidden md:flex`.
 * It opens the app's mobile drawer (the kit's Drawer): a rail with the brand row and the nav items
 * as the app's nav list. Closes on route change, on Escape and on a scrim tap. The tenant's apps
 * follow the nav items as plain links to `/<name>/`.
 */
export function MobileNav({
  locale,
  items,
  apps,
  brand,
  label,
  openLabel,
  closeLabel,
}: {
  locale: string;
  items: NavItem[];
  apps: string[];
  brand: BrandMarkProps;
  /** Accessible name of the drawer. */
  label: string;
  openLabel: string;
  closeLabel: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const homeHref = `/${locale}`;

  // Close when the route changes (a link inside the drawer was followed).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (!items.length && !apps.length) return null;

  return (
    <div className="md:hidden">
      <button type="button" aria-label={openLabel} aria-expanded={open} onClick={() => setOpen(true)} className={topBarButtonClass}>
        <Menu className="h-5 w-5" />
      </button>

      <Drawer open={open} onClose={() => setOpen(false)} label={label} className="md:hidden">
        <div className="flex h-full w-72 flex-col border-r border-border bg-surface">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
            <BrandMark {...brand} fill />
            <button type="button" className={railButtonClass} onClick={() => setOpen(false)} aria-label={closeLabel}>
              <X className="h-5 w-5" />
            </button>
          </div>
          <nav aria-label="Primary" className="min-h-0 flex-1 overflow-y-auto p-2">
            <NavList>
              {items.map((item, i) => {
                const href = navHref(locale, item);
                const active = isActiveHref(pathname, href, homeHref);
                return (
                  <li key={`${item.label}-${i}`}>
                    <Link href={href} aria-current={active ? "page" : undefined} data-ui="nav-leaf" className={navLeafClass(active)}>
                      {item.label}
                    </Link>
                  </li>
                );
              })}
              {apps.map((app) => (
                <li key={app}>
                  <a href={`/${app}/`} data-ui="nav-leaf" className={navLeafClass(false)}>
                    {app}
                  </a>
                </li>
              ))}
            </NavList>
          </nav>
        </div>
      </Drawer>
    </div>
  );
}
