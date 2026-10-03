"use client";

import { ChevronDown } from "lucide-react";
import { Menu, topBarButtonClass } from "@digitaplatform/components";
import type { NavItem } from "@/lib/types";
import { useSiteConfig } from "@/config/ConfigProvider";
import { filterNavItems, isContactItem } from "@/lib/nav";
import { NavMenuEntries } from "./NavMenuEntries";

/** Whether a family item is the site the visitor is on: its link's host is the site's domain. */
export function isCurrentSite(item: NavItem, domain: string | undefined): boolean {
  if (!domain || !item.href) return false;
  try {
    return new URL(item.href).hostname.replace(/^www\./, "") === domain;
  } catch {
    return false;
  }
}

/** The four dots of the product family, the canvas's switcher icon. */
function FamilyIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      {[3, 11].flatMap((x) => [3, 11].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" fill="currentColor" />))}
    </svg>
  );
}

/**
 * The product family menu at the top right: the sites and products of the family, from the menu
 * tree at location "family", a heading over the entries under it. The site the visitor is on is
 * marked and links nowhere; the others open in a new tab; a product without a link shows as
 * coming. The phone shows the same list inside MobileNav.
 */
export function FamilySwitcher({
  locale,
  items,
  domain,
  label,
  comingLabel,
}: {
  locale: string;
  items: NavItem[];
  domain?: string;
  label: string;
  comingLabel: string;
}) {
  const { contactEnabled } = useSiteConfig();
  const available = filterNavItems(items, (item) => contactEnabled || !isContactItem(item));
  if (!available.length) return null;
  return (
    <Menu
      label={label}
      align="end"
      panelClassName="w-64"
      triggerClassName={`${topBarButtonClass} flex items-center gap-1.5 border border-border`}
      trigger={
        <>
          <FamilyIcon />
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </>
      }
    >
      {(close) => (
        <NavMenuEntries locale={locale} items={available} comingLabel={comingLabel} close={close} isCurrent={(item) => isCurrentSite(item, domain)} />
      )}
    </Menu>
  );
}
