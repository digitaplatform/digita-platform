import type { CSSProperties, ReactNode } from "react";
import { notFound } from "next/navigation";
import { brandingStyle, signatureStyle, MODE_STORAGE_KEY } from "@digitaplatform/theme";
import { signature as digitaSignature } from "@digitaplatform/digita";
import "../globals.css";
import type { Locale } from "@/i18n/config";
import { isLocale } from "@/config/locales";
import { getConfig, publicConfig } from "@/config/env";
import { ConfigProvider } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { getSite, getNav, getBranding } from "@/lib/engine-client";
import { mediaUrl } from "@/lib/media";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ThemeKeeper } from "@/components/ThemeKeeper";

// Rendered on-demand (config + content are runtime, never baked at build); engine
// fetches are cache-tagged with a runtime TTL (see engine-client).
export const dynamic = "force-dynamic";

/** Set the `.dark` class before paint from the mode the app stores (one origin, one key), so the
 *  page never flashes the wrong mode. Same resolution as the theme's resolveInitialMode + applyMode. */
const MODE_SCRIPT = `(function(){try{var m=localStorage.getItem(${JSON.stringify(MODE_STORAGE_KEY)});var d=m==='dark'||(m!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale, getConfig().locales)) notFound();

  const [site, headerNav, footerNav, branding] = await Promise.all([
    getSite(),
    getNav(locale, "header"),
    getNav(locale, "footer"),
    getBranding(),
  ]);

  // The app's identity, rendered on the server: the platform signature first, the tenant's
  // branding over it, exactly the order the app applies them in.
  const signature = signatureStyle(digitaSignature);
  const tenant = brandingStyle(branding);
  const attributes = { ...signature.attributes, ...tenant.attributes };
  const properties = { ...signature.properties, ...tenant.properties };

  return (
    <html lang={locale} style={properties as CSSProperties} {...attributes} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: MODE_SCRIPT }} />
      </head>
      <body className="flex min-h-screen flex-col bg-background font-sans text-textMain">
        <ConfigProvider value={publicConfig()}>
          <ThemeKeeper />
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-textMain"
          >
            {t(locale as Locale, "skipToContent")}
          </a>
          <Header
            locale={locale as Locale}
            site={site}
            nav={headerNav}
            logo={branding?.logo ? mediaUrl(branding.logo) : undefined}
            monogram={digitaSignature.monogram}
          />
          <main id="main" className="flex-1">
            {children}
          </main>
          <Footer locale={locale as Locale} site={site} nav={footerNav} />
        </ConfigProvider>
      </body>
    </html>
  );
}
