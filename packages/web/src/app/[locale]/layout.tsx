import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brandingStyle, signatureStyle, PAGE_IDENTITY_ELEMENT_ID } from "@digitaplatform/theme";
import { IDENTITY_BOOT_SCRIPT } from "@digitaplatform/theme/identity-boot";
import favicon from "@digitaplatform/theme/favicon.svg";
import { SignatureBackdrop } from "@digitaplatform/components";
import "../globals.css";
import type { Locale } from "@/i18n/config";
import { isLocale } from "@/config/locales";
import { getConfig, publicConfig } from "@/config/env";
import { ConfigProvider } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { getSite, getNav, getBranding, listPublishedSlugs } from "@/lib/engine-client";
import { siteSignature } from "@/lib/identity";
import { localePath } from "@/lib/nav";
import { jsonForScript } from "@/lib/json-script";
import { mediaUrl } from "@/lib/media";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { DeliveredIdentity } from "@/components/DeliveredIdentity";
import { ContactSheet } from "@/components/ContactSheet";
import { DesignSwitcher } from "@/components/DesignSwitcher";
import { contactSheetTexts, designSwitcherTexts } from "@/components/chrome-texts";

// Rendered on-demand (config + content are runtime, never baked at build); engine
// fetches are cache-tagged with a runtime TTL (see engine-client).
export const dynamic = "force-dynamic";

// The favicon the app loads too, as metadata so every response carries it, 404s included.
export const metadata: Metadata = { icons: { icon: { url: favicon.src, type: "image/svg+xml" } } };

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const config = getConfig();
  if (!isLocale(locale, config.locales)) notFound();

  const [site, headerNav, footerNav, familyNav, branding, publishedSlugs] = await Promise.all([
    getSite(),
    getNav(locale, "header"),
    getNav(locale, "footer"),
    getNav(locale, "family"),
    getBranding(),
    listPublishedSlugs(),
  ]);

  // The identity a visitor without choices of their own sees, rendered on the server: the site's
  // signature with the tenant's branding over it. Before first paint the app's own identity boot
  // (IDENTITY_BOOT_SCRIPT, the bootIdentity the app runs) applies this browser's stored design,
  // tint, mode, signature and density — app and website share one origin, so one choice shows in
  // both.
  const signature = siteSignature(site?.theme);
  const signatureStyles = signatureStyle(signature);
  const tenant = brandingStyle(branding);
  const attributes = { ...signatureStyles.attributes, ...tenant.attributes };
  const properties = { ...signatureStyles.properties, ...tenant.properties };
  const siteConfig = publicConfig(site);
  // A website carries its own name: the site's `site_name` wins over the tenant's `app_name`,
  // which names the tenant's apps, not its public site.
  const brand = {
    name: site?.site_name ?? branding?.app_name ?? "Digita",
    logoUrl: branding?.logo ? mediaUrl(branding.logo) : undefined,
    nameIsCustom: Boolean(site?.site_name ?? branding?.app_name),
    signature,
  };
  const identitySources = { apps: config.tenantApps, authUrl: config.authUrl, authCookieSuffix: config.authCookieSuffix };

  return (
    <html lang={locale} style={properties as CSSProperties} {...attributes} suppressHydrationWarning>
      <head>
        <script
          type="application/json"
          id={PAGE_IDENTITY_ELEMENT_ID}
          dangerouslySetInnerHTML={{ __html: jsonForScript({ signatures: [signature], branding }) }}
        />
        <script dangerouslySetInnerHTML={{ __html: IDENTITY_BOOT_SCRIPT }} />
      </head>
      <body className="bg-background text-textMain antialiased">
        <ConfigProvider value={siteConfig}>
          <div className="relative isolate flex min-h-screen flex-col">
            <SignatureBackdrop graphics={signature.graphics} />
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-btn focus:bg-primary-600 focus:px-3 focus:py-2 focus:text-sm focus:text-onPrimary"
            >
              {t("skipToContent", locale as Locale)}
            </a>
            <Header
              locale={locale as Locale}
              defaultLocale={config.defaultLocale}
              site={site}
              nav={headerNav}
              family={familyNav}
              apps={site?.link_apps === false ? [] : config.tenantApps}
              brand={brand}
              contactEnabled={siteConfig.contactEnabled}
              publishedSlugs={publishedSlugs}
              enabledLocales={(site?.enabled_locales ?? []).filter(Boolean)}
            />
            <main id="main" className="flex-1">
              {children}
            </main>
            {site?.design_switcher && <DesignSwitcher {...identitySources} texts={designSwitcherTexts(locale)} />}
            <Footer locale={locale as Locale} site={site} nav={footerNav} brand={brand} />
            {siteConfig.contactEnabled && site?.contact_email && (
              <ContactSheet
                locale={locale}
                texts={contactSheetTexts(locale)}
                contactEmail={site.contact_email}
                bookingUrl={site.booking_url || undefined}
                privacyHref={localePath(locale, config.defaultLocale, "/privacy")}
                renderedAt={Date.now()}
              />
            )}
            <DeliveredIdentity {...identitySources} />
          </div>
        </ConfigProvider>
      </body>
    </html>
  );
}
