import Link from "next/link";
import { BrandMark, TopBar, buttonAttributes, type BrandMarkProps } from "@digitaplatform/components";
import type { Locale } from "@/i18n/config";
import type { NavItem, WebNavMenu, WebSite } from "@/lib/types";
import { localePath, sortNav } from "@/lib/nav";
import { t } from "@/i18n/messages";
import { SheetButton } from "@/blocks/marketing/SheetButton";
import { NavLinks } from "./NavLinks";
import { MobileNav } from "./MobileNav";
import { FamilySwitcher } from "./FamilySwitcher";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { ThemeToggle } from "./ThemeToggle";

/** The header menu item that is the site's call to action: it opens the contact sheet. */
const CONTACT_HREF = "#contact";

/** The call to action of the header: the contact sheet where the site offers it, else a mail to
 *  the site's address, else nothing. */
function ContactButton({ item, contactEnabled, contactEmail }: { item: NavItem; contactEnabled: boolean; contactEmail?: string }) {
  const attributes = buttonAttributes({ size: "sm", className: "shrink-0" });
  if (contactEnabled) return <SheetButton {...attributes}>{item.label}</SheetButton>;
  if (!contactEmail) return null;
  return (
    <a href={`mailto:${contactEmail}`} {...attributes}>
      {item.label}
    </a>
  );
}

/** Site header: the app's top bar (the kit's TopBar) with the app's brand precedence (BrandMark),
 *  the content-driven nav, the product family menu, the language menu, the mode button and the
 *  call to action. A phone keeps the brand, the call to action and the menu button; the rest moves
 *  into MobileNav. */
export function Header({
  locale,
  defaultLocale,
  site,
  nav,
  family,
  apps,
  brand,
  contactEnabled,
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
  contactEnabled: boolean;
  /** The published pages per locale, as slugs, handed to the language menu. */
  publishedSlugs: Record<string, string[]>;
  /** The site's own narrowing of the served locales; empty means all of them. */
  enabledLocales: string[];
}) {
  const all = sortNav(nav?.items);
  const contact = all.find((item) => item.href === CONTACT_HREF);
  const items = all.filter((item) => item !== contact);
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

        <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="Primary">
          <NavLinks locale={locale} items={items} apps={apps} comingLabel={comingLabel} />
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <div className="hidden items-center gap-1 md:flex">
            <FamilySwitcher locale={locale} items={familyItems} domain={site?.domain} label={t("familyLabel", locale)} comingLabel={comingLabel} />
            {controls}
          </div>
          {contact && <ContactButton item={contact} contactEnabled={contactEnabled} contactEmail={site?.contact_email} />}
          <MobileNav
            locale={locale}
            items={items}
            apps={apps}
            family={familyItems}
            domain={site?.domain}
            brand={brand}
            label={t("navigation", locale)}
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
