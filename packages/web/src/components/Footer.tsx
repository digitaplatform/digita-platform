import { BrandMark, VersionFooter, type BrandMarkProps } from "@digitaplatform/components";
import type { Locale } from "@/i18n/config";
import type { NavItem, WebSite } from "@/lib/types";
import { filterNavItems, isContactItem, menuEntries } from "@/lib/nav";
import { t } from "@/i18n/messages";
import { NavItemLink } from "./NavItemLink";

const LINK = "inline-flex w-fit items-center gap-1 text-sm text-textMain transition-colors hover:text-primaryText";

/**
 * Site footer, the columns of the canvas: the brand with the site's contact address, then the
 * footer menu, which carries the site's pages, the family's other sites and the legal pages in the
 * visitor's language, flowing into columns; its item for the contact sheet opens the sheet. The
 * site's footer text closes it.
 */
export function Footer({
  locale,
  site,
  nav,
  brand,
  contactEnabled,
  versionEndpoints = [],
  engineVersion,
}: {
  locale: Locale;
  site: WebSite | null;
  nav: NavItem[];
  brand: BrandMarkProps;
  /** Whether the page offers the contact sheet, by the layout's rule the header and the drawer
   *  read too (publicConfig): a server component cannot read the site config's context. */
  contactEnabled: boolean;
  versionEndpoints?: readonly string[];
  engineVersion?: unknown;
}) {
  // Without the sheet an item for it would lead nowhere, so it is left out.
  const entries = menuEntries(filterNavItems(nav, (item) => contactEnabled || !isContactItem(item)));

  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 pb-10 pt-14 md:px-8">
        <div className="grid gap-10 md:grid-cols-3">
          <div className="flex flex-col gap-3.5">
            <div className="flex items-center gap-2">
              <BrandMark {...brand} />
            </div>
            {site?.contact_email && (
              <a href={`mailto:${site.contact_email}`} className="w-fit text-sm text-textMuted transition-colors hover:text-textMain">
                {site.contact_email}
              </a>
            )}
          </div>
          {entries.length > 0 && (
            <nav aria-label={t("navFooter", locale)} className="md:col-span-2">
              <ul className="gap-x-8 sm:columns-2 lg:columns-3">
                {entries.map((entry, i) =>
                  "heading" in entry ? (
                    <li key={`${entry.heading}-${i}`} className="mb-2.5 break-inside-avoid text-sm font-medium text-textMuted">
                      {entry.heading}
                    </li>
                  ) : (
                    <li key={`${entry.item.label}-${i}`} className="mb-2.5 break-inside-avoid">
                      <NavItemLink locale={locale} item={entry.item} comingLabel={t("familyComing", locale)} className={LINK} />
                    </li>
                  ),
                )}
              </ul>
            </nav>
          )}
        </div>
        {site?.footer_text && <p className="text-sm text-textMuted">{site.footer_text}</p>}
      </div>
      <VersionFooter endpoints={versionEndpoints} initialImages={engineVersion ? [engineVersion] : []} engineSource="server:0" />
    </footer>
  );
}
