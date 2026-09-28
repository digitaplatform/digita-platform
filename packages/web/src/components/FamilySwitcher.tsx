"use client";

import { Check, ChevronDown } from "lucide-react";
import { Menu, topBarButtonClass } from "@digitaplatform/components";
import type { NavItem } from "@/lib/types";
import { NavItemLink } from "./NavItemLink";

/** Whether a family item is the site the visitor is on: its link's host is the site's domain. */
export function isCurrentSite(item: NavItem, domain: string | undefined): boolean {
  if (!domain || !item.href) return false;
  try {
    return new URL(item.href).hostname.replace(/^www\./, "") === domain;
  } catch {
    return false;
  }
}

const ITEM =
  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-textMain transition-colors duration-base ease-smooth hover:bg-bgHover focus:bg-bgHover focus:outline-none";

/** The four dots of the product family, the canvas's switcher icon. */
function FamilyIcon() {
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
      {[3, 11].flatMap((x) => [3, 11].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" fill="currentColor" />))}
    </svg>
  );
}

/**
 * The product family menu at the top right: the sites and products of the family, from the
 * WebNavMenu at location "family". The site the visitor is on is marked and links nowhere; the
 * others open in a new tab; a product without a link shows as coming. The phone shows the same
 * list inside MobileNav.
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
  if (!items.length) return null;
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
      {() =>
        items.map((item, i) =>
          isCurrentSite(item, domain) ? (
            <span key={`${item.label}-${i}`} role="menuitem" aria-current="true" tabIndex={-1} className={`${ITEM} font-semibold`}>
              {item.label}
              <Check className="ml-auto h-4 w-4 text-primary-600" aria-hidden="true" />
            </span>
          ) : (
            <NavItemLink key={`${item.label}-${i}`} locale={locale} item={item} comingLabel={comingLabel} role="menuitem" className={ITEM} />
          ),
        )
      }
    </Menu>
  );
}
