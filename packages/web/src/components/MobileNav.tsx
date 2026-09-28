"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { BrandMark, Drawer, NavList, navLeafClass, railButtonClass, topBarButtonClass, type BrandMarkProps } from "@digitaplatform/components";
import type { NavItem } from "@/lib/types";
import { useActiveItem } from "./NavLinks";
import { NavItemLink } from "./NavItemLink";
import { isCurrentSite } from "./FamilySwitcher";

/**
 * Mobile navigation — the phone counterpart to the desktop header, whose nav, family menu,
 * language menu and mode button are `hidden md:flex`. It opens the app's mobile drawer (the kit's
 * Drawer): a rail with the brand row, the nav items as the app's nav list, the tenant's apps as
 * plain links to `/<name>/`, the product family, and `children` (the language menu and the mode
 * button) at the foot. Closes on route change, on Escape and on a scrim tap.
 */
export function MobileNav({
  locale,
  items,
  apps,
  family,
  domain,
  brand,
  label,
  openLabel,
  closeLabel,
  children,
}: {
  locale: string;
  items: NavItem[];
  apps: string[];
  family: NavItem[];
  /** The site's domain, which marks the family item of the site the visitor is on. */
  domain?: string;
  brand: BrandMarkProps;
  /** Accessible name of the drawer. */
  label: string;
  openLabel: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = useActiveItem(locale);

  // Close when the route changes (a link inside the drawer was followed).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

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
                const active = isActive(item);
                return (
                  <li key={`${item.label}-${i}`}>
                    <NavItemLink locale={locale} item={item} current={active} data-ui="nav-leaf" className={navLeafClass(active)} />
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
            {family.length > 0 && <div aria-hidden="true" className="my-2 h-px bg-border" />}
            {family.length > 0 && (
              <NavList>
                {family.map((item, i) => (
                  <li key={`${item.label}-${i}`}>
                    {isCurrentSite(item, domain) ? (
                      <span aria-current="true" className={navLeafClass(true)}>
                        {item.label}
                      </span>
                    ) : (
                      <NavItemLink locale={locale} item={item} data-ui="nav-leaf" className={navLeafClass(false)} />
                    )}
                  </li>
                ))}
              </NavList>
            )}
          </nav>
          <div className="flex shrink-0 items-center gap-1 border-t border-border p-2">{children}</div>
        </div>
      </Drawer>
    </div>
  );
}
