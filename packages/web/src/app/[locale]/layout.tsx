import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { brandingStyle, darkBandIdentityRule, lookCookieDomain, signatureStyle, tabIconHref, PAGE_IDENTITY_ELEMENT_ID } from "@digitaplatform/theme";
import { IDENTITY_BOOT_SCRIPT } from "@digitaplatform/theme/identity-boot";
import favicon from "@digitaplatform/theme/favicon.svg";
import { SignatureBackdrop } from "@digitaplatform/components";
import "../globals.css";
import type { Locale } from "@/i18n/config";
import { isLocale } from "@/config/locales";
import { getConfig, publicConfig } from "@/config/env";
import { ConfigProvider } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { getSite, getNav, getBranding, findWebsiteSignature, listPublishedSlugs } from "@/lib/engine-client";
import { siteSignature } from "@/lib/identity";
import { localePath } from "@/lib/nav";
import { jsonForScript } from "@/lib/json-script";
import { brandingImageUrl } from "@/lib/media";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { DeliveredIdentity } from "@/components/DeliveredIdentity";
import { ContactSheet } from "@/components/ContactSheet";
import { DesignSwitcher } from "@/components/DesignSwitcher";
import { contactSheetTexts, designSwitcherTexts } from "@/components/chrome-texts";

// Rendered on-demand (config + content are runtime, never baked at build); engine
// fetches are cache-tagged with a runtime TTL (see engine-client).
export const dynamic = "force-dynamic";

// The tab shows the icon of the site's signature, else the platform's, which the app loads too; as
// metadata, so every response carries it, 404s included.
export async function generateMetadata(): Promise<Metadata> {
  const [site, websiteLook] = await Promise.all([getSite(), findWebsiteSignature()]);
  const icon = tabIconHref(undefined, siteSignature(site?.theme, websiteLook)) ?? favicon.src;
  return { icons: { icon: { url: icon, type: "image/svg+xml" } } };
}

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

  const [site, headerNav, footerNav, familyNav, branding, websiteLook, publishedSlugs] = await Promise.all([
    getSite(),
    getNav(locale, "header"),
    getNav(locale, "footer"),
    getNav(locale, "family"),
    getBranding(),
    findWebsiteSignature(),
    listPublishedSlugs(),
  ]);

  // The identity rendered on the server: the site's signature (its own `theme`, else the website
  // look of the tenant's settings) with the tenant's branding over it.
  // Before first paint the app's own identity boot (IDENTITY_BOOT_SCRIPT, the bootIdentity the app
  // runs) applies this browser's stored design, tint, mode and density — app and website share one
  // origin, so one choice shows in both — and keeps the site's signature, which is the site's
  // identity, not a visitor's choice.
  const signature = siteSignature(site?.theme, websiteLook);
  const signatureStyles = signatureStyle(signature);
  const tenant = brandingStyle(branding);
  const attributes = { ...signatureStyles.attributes, ...tenant.attributes };
  const properties = { ...signatureStyles.properties, ...tenant.properties };
  // A block set to theme_variant "dark" keeps the site's signature and the tenant's brand.
  const darkBandRule = darkBandIdentityRule(properties);
  const siteConfig = publicConfig(site, {
    title: t("notFoundTitle", locale as Locale),
    body: t("notFoundBody", locale as Locale),
    home: t("notFoundHome", locale as Locale),
  });
  // A website carries its own name: the site's `site_name` wins over the tenant's `app_name`,
  // which names the tenant's apps, not its public site. Without either, as when the engine answers
  // no readable row for SITE_ID, the site wears its look's name, as the app does.
  const brand = {
    name: site?.site_name || branding?.app_name || signature.name,
    logoUrl: brandingImageUrl(branding?.logo),
    nameIsCustom: Boolean(site?.site_name || branding?.app_name),
    signature,
  };
  // The middleware makes a nonce per request; without it the boot script would not run under the
  // policy, so a missing nonce is an error, not a script without one.
  const nonce = (await headers()).get("x-nonce");
  if (!nonce) throw new Error("[digita-web] the request carries no x-nonce: the middleware did not run");
  const identitySources = { apps: config.tenantApps, authUrl: config.authUrl, authCookieSuffix: config.authCookieSuffix };
  // The site follows its engine's lock, as the app does: no mode button, and the system mode painted.
  const modeLocked = branding?.allow_user_theme_mode === false;

  return (
    <html lang={locale} style={properties as CSSProperties} {...attributes} suppressHydrationWarning>
      <head>
        <script
          type="application/json"
          id={PAGE_IDENTITY_ELEMENT_ID}
          dangerouslySetInnerHTML={{ __html: jsonForScript({ signature: signature.id, signatures: [signature], branding, ...(modeLocked ? { mode: "system" } : {}) }) }}
        />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: IDENTITY_BOOT_SCRIPT }} />
        {darkBandRule && <style dangerouslySetInnerHTML={{ __html: darkBandRule }} />}
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
              publishedSlugs={publishedSlugs}
              enabledLocales={(site?.enabled_locales ?? []).filter(Boolean)}
              identity={identitySources}
              lookCookieDomain={lookCookieDomain(config.authUrl ?? "")}
              modeLocked={modeLocked}
            />
            <main id="main" className="flex-1">
              {children}
            </main>
            {site?.design_switcher && <DesignSwitcher {...identitySources} texts={designSwitcherTexts(locale)} />}
            <Footer locale={locale as Locale} site={site} nav={footerNav} brand={brand} contactEnabled={siteConfig.contactEnabled} />
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
