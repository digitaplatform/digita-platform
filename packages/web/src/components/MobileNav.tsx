"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { BrandMark, Drawer, NavList, navLeafClass, railButtonClass, topBarButtonClass, type BrandMarkProps } from "@digitaplatform/components";
import { useSiteConfig } from "@/config/ConfigProvider";
import type { NavItem } from "@/lib/types";
import { isContactItem, menuEntries } from "@/lib/nav";
import { useActiveItem } from "./NavLinks";
import { NavItemLink } from "./NavItemLink";
import { isCurrentSite } from "./FamilySwitcher";

/** A heading of the drawer's lists: the label of a menu node over the entries under it. */
const HEADING = "px-3 pb-1 pt-3 text-xs font-medium text-textMuted";

/**
 * Mobile navigation — the phone counterpart to the desktop header, whose text links and family
 * menu are `hidden md:flex`; the bar itself carries the language menu and the mode button on a
 * phone. It opens the app's mobile drawer (the kit's Drawer): a rail with the brand row, the nav
 * items as the app's nav list, the tenant's apps as plain links to `/<name>/`, and the product
 * family. Closes on route change, on Escape and on a scrim tap.
 */
export function MobileNav({
  locale,
  items,
  apps,
  family,
  domain,
  brand,
  label,
  navLabel,
  openLabel,
  closeLabel,
  comingLabel,
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
  /** Accessible name of the nav landmark inside the drawer. */
  navLabel: string;
  openLabel: string;
  closeLabel: string;
  comingLabel: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = useActiveItem(locale);
  // Without the contact sheet the family's item for it would lead nowhere, so it is left out, as the footer leaves it out.
  const { contactEnabled } = useSiteConfig();
  const familyEntries = menuEntries(family).filter((entry) => !("item" in entry) || contactEnabled || !isContactItem(entry.item));

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
          <nav aria-label={navLabel} className="min-h-0 flex-1 overflow-y-auto p-2">
            <NavList>
              {menuEntries(items).map((entry, i) => {
                if ("heading" in entry) {
                  return (
                    <li key={`${entry.heading}-${i}`} className={HEADING}>
                      {entry.heading}
                    </li>
                  );
                }
                const { item } = entry;
                const active = isActive(item);
                return (
                  <li key={`${item.label}-${i}`}>
                    <NavItemLink
                      locale={locale}
                      item={item}
                      comingLabel={comingLabel}
                      current={active}
                      onSelect={() => setOpen(false)}
                      data-ui="nav-leaf"
                      className={navLeafClass(active)}
                    />
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
            {familyEntries.length > 0 && <div aria-hidden="true" className="my-2 h-px bg-border" />}
            {familyEntries.length > 0 && (
              <NavList>
                {familyEntries.map((entry, i) =>
                  "heading" in entry ? (
                    <li key={`${entry.heading}-${i}`} className={HEADING}>
                      {entry.heading}
                    </li>
                  ) : (
                    <li key={`${entry.item.label}-${i}`}>
                      {isCurrentSite(entry.item, domain) ? (
                        <span aria-current="true" className={navLeafClass(true)}>
                          {entry.item.label}
                        </span>
                      ) : (
                        <NavItemLink
                          locale={locale}
                          item={entry.item}
                          comingLabel={comingLabel}
                          onSelect={() => setOpen(false)}
                          data-ui="nav-leaf"
                          className={navLeafClass(false)}
                        />
                      )}
                    </li>
                  ),
                )}
              </NavList>
            )}
          </nav>
        </div>
      </Drawer>
    </div>
  );
}
