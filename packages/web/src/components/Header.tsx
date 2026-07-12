import Link from "next/link";
import type { Locale } from "@/i18n/config";
import type { WebNavMenu, WebSite } from "@/lib/types";
import { sortNav } from "@/lib/nav";
import { t } from "@/i18n/messages";
import { NavLinks } from "./NavLinks";
import { MobileNav } from "./MobileNav";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { ThemeToggle } from "./ThemeToggle";

/** Site header: brand + content-driven nav + locale switch + theme toggle. */
export function Header({
  locale,
  site,
  nav,
}: {
  locale: Locale;
  site: WebSite | null;
  nav: WebNavMenu | null;
}) {
  const items = sortNav(nav?.items);
  const enabled = (site?.enabled_locales ?? []).filter(Boolean) as Locale[];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-glass backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-6 md:px-8">
        <Link href={`/${locale}`} className="min-w-0 shrink truncate text-base font-semibold tracking-tight text-fg">
          {site?.site_name ?? "Digita"}
        </Link>

        <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="Primary">
          <NavLinks locale={locale} items={items} />
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <LocaleSwitcher current={locale} enabled={enabled} label={t(locale, "language")} />
          <ThemeToggle label={t(locale, "toggleTheme")} />
          <MobileNav
            locale={locale}
            items={items}
            openLabel={t(locale, "openMenu")}
            closeLabel={t(locale, "closeMenu")}
          />
        </div>
      </div>
    </header>
  );
}
