"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { AriaRole } from "react";
import { useSiteConfig } from "@/config/ConfigProvider";
import type { NavItem } from "@/lib/types";
import { isContactItem, isExternalHref, navHref } from "@/lib/nav";
import { SheetButton } from "@/blocks/marketing/SheetButton";

/**
 * One menu item, the same way in every menu of the site: a site path in the page's locale, a web
 * link in a new tab with an arrow, an item without a link as its label marked coming, and the item
 * for the contact sheet as the button that opens it, since no page holds a `#contact` anchor.
 */
export function NavItemLink({
  locale,
  item,
  comingLabel,
  className,
  current = false,
  role,
  onSelect,
  "data-ui": ui,
}: {
  locale: string;
  item: NavItem;
  /** The suffix of an item without a link, `familyComing` in the page's locale. */
  comingLabel: string;
  className?: string;
  /** Marks a site path as the page the visitor is on. */
  current?: boolean;
  /** "menuitem" inside a kit Menu, whose arrow keys move focus over the items. */
  role?: AriaRole;
  /** Closes the menu or drawer when its item is selected. */
  onSelect?: () => void;
  /** The kit element a design restyles, as `nav-leaf` for the app's nav items. */
  "data-ui"?: string;
}) {
  const { defaultLocale } = useSiteConfig();
  const href = navHref(locale, defaultLocale, item);
  // Inside a Menu every item takes programmatic focus; outside, only the links are tab stops.
  const tabIndex = role ? -1 : undefined;

  if (isContactItem(item)) {
    return (
      <SheetButton data-ui={ui} role={role} tabIndex={tabIndex} className={className} onOpen={onSelect}>
        {item.label}
      </SheetButton>
    );
  }
  if (!href) {
    return (
      <span data-ui={ui} role={role} aria-disabled={role ? true : undefined} tabIndex={tabIndex} className={className}>
        {item.label} <span className="text-textMuted">· {comingLabel}</span>
      </span>
    );
  }
  if (isExternalHref(href)) {
    return (
      <a data-ui={ui} href={href} target="_blank" rel="noopener noreferrer" role={role} tabIndex={tabIndex} className={className} onClick={onSelect}>
        {item.label}
        <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      </a>
    );
  }
  return (
    <Link data-ui={ui} href={href} role={role} tabIndex={tabIndex} aria-current={current ? "page" : undefined} className={className} onClick={onSelect}>
      {item.label}
    </Link>
  );
}
