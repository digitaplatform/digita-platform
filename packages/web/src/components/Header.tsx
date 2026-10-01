import Link from "next/link";
import { icons, type LucideIcon } from "lucide-react";
import { BrandMark, TopBar, buttonAttributes, cn, type BrandMarkProps } from "@digitaplatform/components";
import type { Locale } from "@/i18n/config";
import type { NavItem, WebNavMenu, WebSite } from "@/lib/types";
import { isContactItem, localePath, navHref, sortNav } from "@/lib/nav";
import { t } from "@/i18n/messages";
import { SheetButton } from "@/blocks/marketing/SheetButton";
import { NavIconLink, NavLinks } from "./NavLinks";
import { MobileNav } from "./MobileNav";
import { FamilySwitcher } from "./FamilySwitcher";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { ThemeToggle } from "./ThemeToggle";

/** The lucide icon a menu item names, in kebab or Pascal case. The site's data names it, so the
 *  renderer keeps no list of icons; a name lucide lacks is reported, and the item shows as one
 *  that names no icon. */
function iconOf(item: NavItem): LucideIcon | undefined {
  if (!item.icon) return undefined;
  const key = item.icon
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  const icon = (icons as Record<string, LucideIcon | undefined>)[key];
  if (!icon) console.error(`[digita-web] the menu item "${item.label}" names the icon "${item.icon}", which lucide does not have`);
  return icon;
}

/** Site header: the app's top bar (the kit's TopBar) with the app's brand precedence (BrandMark),
 *  the content-driven nav, the product family menu, the language menu, the mode button and the
 *  call to action. Every width shows the language menu and the mode button. Below lg a link whose
 *  data names an icon shows as that icon; a tablet shows the other links as text, and a phone
 *  keeps them, the tenant's apps and the family behind the menu button (MobileNav). */
export function Header({
  locale,
  defaultLocale,
  site,
  nav,
  family,
  apps,
  brand,
  publishedSlugs,
  enabledLocales,
}: {
  locale: Locale;
  defaultLocale: Locale;
  site: WebSite | null;
  nav: WebNavMenu | null;
  family: WebNavMenu | null;
  apps: string[];
  brand: BrandMarkProps;
  /** The published pages per locale, as slugs, handed to the language menu. */
  publishedSlugs: Record<string, string[]>;
  /** The site's own narrowing of the served locales; empty means all of them. */
  enabledLocales: string[];
}) {
  const all = sortNav(nav?.items);
  const contact = all.find(isContactItem);
  const items = all.filter((item) => item !== contact);
  const iconLinks = items.flatMap((item) => {
    const icon = iconOf(item);
    const href = navHref(locale, defaultLocale, item);
    return icon && href ? [{ item, icon, href }] : [];
  });
  const textItems = items.filter((item) => !iconLinks.some((link) => link.item === item));
  const familyItems = sortNav(family?.items);
  const comingLabel = t("familyComing", locale);
  const controls = (
    <>
      <LocaleSwitcher current={locale} publishedSlugs={publishedSlugs} enabledLocales={enabledLocales} label={t("language", locale)} />
      <ThemeToggle label={t("toggleTheme", locale)} />
    </>
  );

  return (
    <TopBar>
      <div className="mx-auto flex w-full max-w-6xl items-center gap-6">
        <Link href={localePath(locale, defaultLocale)} className="flex min-w-0 shrink items-center gap-2">
          <BrandMark {...brand} />
        </Link>

        <nav className={cn(iconLinks.length > 0 ? "flex" : "hidden md:flex", "flex-1 items-center gap-1")} aria-label={t("navPrimary", locale)}>
          {iconLinks.length > 0 && (
            <div className="flex items-center gap-1 lg:hidden">
              {iconLinks.map(({ item, icon: Icon, href }, i) => (
                <NavIconLink key={`${item.label}-${i}`} locale={locale} href={href} item={item}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </NavIconLink>
              ))}
            </div>
          )}
          <div className="hidden items-center gap-1 md:flex lg:hidden">
            <NavLinks locale={locale} items={textItems} apps={apps} comingLabel={comingLabel} />
          </div>
          <div className="hidden items-center gap-1 lg:flex">
            <NavLinks locale={locale} items={items} apps={apps} comingLabel={comingLabel} />
          </div>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {familyItems.length > 0 && (
            <div className="hidden items-center gap-1 md:flex">
              <FamilySwitcher locale={locale} items={familyItems} domain={site?.domain} label={t("familyLabel", locale)} comingLabel={comingLabel} />
            </div>
          )}
          {controls}
          {/* The header menu's item for the contact sheet; SheetButton draws nothing where the site offers no sheet. */}
          {contact && <SheetButton {...buttonAttributes({ size: "sm", className: "shrink-0" })}>{contact.label}</SheetButton>}
          <MobileNav
            locale={locale}
            items={items}
            apps={apps}
            family={familyItems}
            domain={site?.domain}
            brand={brand}
            label={t("navigation", locale)}
            navLabel={t("navPrimary", locale)}
            openLabel={t("openMenu", locale)}
            closeLabel={t("closeMenu", locale)}
            comingLabel={comingLabel}
          >
            {controls}
          </MobileNav>
        </div>
      </div>
    </TopBar>
  );
}
