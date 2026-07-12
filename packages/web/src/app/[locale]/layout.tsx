import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import "../globals.css";
import type { Locale } from "@/i18n/config";
import { isLocale } from "@/config/locales";
import { getConfig, publicConfig } from "@/config/env";
import { ConfigProvider } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { getSite, getNav } from "@/lib/engine-client";
import { resolveTheme } from "@/themes";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ThemeKeeper } from "@/components/ThemeKeeper";

// Rendered on-demand (config + content are runtime, never baked at build); engine
// fetches are cache-tagged with a runtime TTL (see engine-client).
export const dynamic = "force-dynamic";

/** Set the `.dark` class before paint to avoid a flash of the wrong mode. */
const MODE_SCRIPT = `(function(){try{var m=localStorage.getItem('digita-web-mode');var d=m?m==='dark':matchMedia('(prefers-color-scheme:dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale, getConfig().locales)) notFound();

  const [site, headerNav, footerNav] = await Promise.all([
    getSite(),
    getNav(locale, "header"),
    getNav(locale, "footer"),
  ]);

  const theme = resolveTheme(site?.theme);

  return (
    <html lang={locale} className={theme.htmlClass} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: MODE_SCRIPT }} />
      </head>
      <body className="flex min-h-screen flex-col">
        <ConfigProvider value={publicConfig()}>
          <ThemeKeeper />
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:text-fg"
          >
            {t(locale as Locale, "skipToContent")}
          </a>
          <Header locale={locale as Locale} site={site} nav={headerNav} />
          <main id="main" className="flex-1">
            {children}
          </main>
          <Footer locale={locale as Locale} site={site} nav={footerNav} />
        </ConfigProvider>
      </body>
    </html>
  );
}
