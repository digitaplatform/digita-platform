"use client";

import { Check } from "lucide-react";
import type { NavItem } from "@/lib/types";
import { menuEntries } from "@/lib/nav";
import { NavItemLink } from "./NavItemLink";

const ITEM =
  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-textMain transition-colors duration-base ease-smooth hover:bg-bgHover focus:bg-bgHover focus:outline-none";
const HEADING = "block px-3 pb-1 pt-2 text-xs font-medium text-textMuted";

/**
 * The body of a dropdown menu of the site: each heading as a label the arrow keys pass over, each
 * item as a menu item. An item `isCurrent` names is marked and links nowhere, as the family menu
 * marks the site the visitor is on.
 */
export function NavMenuEntries({
  locale,
  items,
  comingLabel,
  close,
  isCurrent = () => false,
}: {
  locale: string;
  items: NavItem[];
  comingLabel: string;
  close: () => void;
  isCurrent?: (item: NavItem) => boolean;
}) {
  return menuEntries(items).map((entry, i) =>
    "heading" in entry ? (
      <span key={`${entry.heading}-${i}`} role="presentation" className={HEADING}>
        {entry.heading}
      </span>
    ) : isCurrent(entry.item) ? (
      <span key={`${entry.item.label}-${i}`} role="menuitem" aria-current="true" tabIndex={-1} className={`${ITEM} font-semibold`}>
        {entry.item.label}
        <Check className="ml-auto h-4 w-4 text-primaryGraphic" aria-hidden="true" />
      </span>
    ) : (
      <NavItemLink
        key={`${entry.item.label}-${i}`}
        locale={locale}
        item={entry.item}
        comingLabel={comingLabel}
        role="menuitem"
        onSelect={close}
        className={ITEM}
      />
    ),
  );
}
