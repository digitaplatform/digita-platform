import Link from "next/link";
import { BrandMark, TopBar } from "@digitaplatform/components";
import type { Signature } from "@digitaplatform/theme";
import type { Locale } from "@/i18n/config";
import type { WebNavMenu, WebSite } from "@/lib/types";
import { sortNav } from "@/lib/nav";
import { t } from "@/i18n/messages";
import { NavLinks } from "./NavLinks";
import { MobileNav } from "./MobileNav";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { ThemeToggle } from "./ThemeToggle";

/** Site header: the app's top bar (the kit's TopBar) with the app's brand precedence (BrandMark),
 *  the content-driven nav, the language menu and the mode button. */
export function Header({
  locale,
  site,
  nav,
  apps,
  brand,
}: {
  locale: Locale;
  site: WebSite | null;
  nav: WebNavMenu | null;
  apps: string[];
  brand: { name: string; logoUrl?: string; nameIsCustom: boolean; signature: Signature };
}) {
  const items = sortNav(nav?.items);
  const enabled = (site?.enabled_locales ?? []).filter(Boolean) as Locale[];

  return (
    <TopBar>
      <div className="mx-auto flex w-full max-w-6xl items-center gap-6">
        <Link href={`/${locale}`} className="flex min-w-0 shrink items-center gap-2">
          <BrandMark {...brand} />
        </Link>

        <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="Primary">
          <NavLinks locale={locale} items={items} apps={apps} />
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <LocaleSwitcher current={locale} enabled={enabled} label={t(locale, "language")} />
          <ThemeToggle label={t(locale, "toggleTheme")} />
          <MobileNav
            locale={locale}
            items={items}
            apps={apps}
            brand={brand}
            label={t(locale, "navigation")}
            openLabel={t(locale, "openMenu")}
            closeLabel={t(locale, "closeMenu")}
          />
        </div>
      </div>
    </TopBar>
  );
}
