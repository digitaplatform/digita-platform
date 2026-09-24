import Link from "next/link";
import type { Locale } from "@/i18n/config";
import type { WebNavMenu, WebSite } from "@/lib/types";
import { sortNav } from "@/lib/nav";
import { t } from "@/i18n/messages";
import { NavLinks } from "./NavLinks";
import { MobileNav } from "./MobileNav";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { ThemeToggle } from "./ThemeToggle";

/** Site header: brand + content-driven nav + locale switch + theme toggle. The brand mark follows
 *  the app's precedence: the tenant's logo, else the signature's monogram. */
export function Header({
  locale,
  site,
  nav,
  logo,
  monogram,
}: {
  locale: Locale;
  site: WebSite | null;
  nav: WebNavMenu | null;
  logo?: string;
  monogram?: string;
}) {
  const items = sortNav(nav?.items);
  const enabled = (site?.enabled_locales ?? []).filter(Boolean) as Locale[];

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surfaceGlass backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-6 md:px-8">
        <Link href={`/${locale}`} className="flex min-w-0 shrink items-center gap-2 text-base font-semibold tracking-tight text-textMain">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="h-7 w-7 shrink-0 rounded" />
          ) : monogram ? (
            <span
              aria-hidden="true"
              className="h-7 w-7 shrink-0 text-primary-600 [&>svg]:h-full [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: monogram }}
            />
          ) : null}
          <span className="truncate">{site?.site_name ?? "Digita"}</span>
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
