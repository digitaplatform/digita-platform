import Link from "next/link";
import type { Locale } from "@/i18n/config";
import type { WebNavMenu, WebSite } from "@/lib/types";
import { navHref, sortNav } from "@/lib/nav";

/** Site footer: content-driven secondary nav + footer text. */
export function Footer({
  locale,
  site,
  nav,
}: {
  locale: Locale;
  site: WebSite | null;
  nav: WebNavMenu | null;
}) {
  const items = sortNav(nav?.items);

  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-10 text-sm text-fg-muted md:flex-row md:items-center md:justify-between md:px-8">
        <p>{site?.footer_text ?? site?.site_name ?? "Digita"}</p>
        {items.length > 0 && (
          <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Footer">
            {items.map((item, i) => (
              <Link
                key={`${item.label}-${i}`}
                href={navHref(locale, item)}
                className="transition-colors hover:text-fg"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </footer>
  );
}
