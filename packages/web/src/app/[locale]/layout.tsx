import type { CSSProperties, ReactNode } from "react";
import { notFound } from "next/navigation";
import { brandingStyle, signatureStyle } from "@digitaplatform/theme";
import { IDENTITY_BOOT_SCRIPT } from "@digitaplatform/theme/identity-boot";
import { SignatureBackdrop } from "@digitaplatform/components";
import "../globals.css";
import type { Locale } from "@/i18n/config";
import { isLocale } from "@/config/locales";
import { getConfig, publicConfig } from "@/config/env";
import { ConfigProvider } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { getSite, getNav, getBranding } from "@/lib/engine-client";
import { defaultSignature } from "@/lib/identity";
import { jsonForScript } from "@/lib/json-script";
import { mediaUrl } from "@/lib/media";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

// Rendered on-demand (config + content are runtime, never baked at build); engine
// fetches are cache-tagged with a runtime TTL (see engine-client).
export const dynamic = "force-dynamic";

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

  // The identity a visitor without choices of their own sees, rendered on the server: the default
  // signature with the tenant's branding over it. Before first paint the app's own identity boot
  // (IDENTITY_BOOT_SCRIPT, the bootIdentity the app runs) applies this browser's stored design,
  // tint, mode, signature and density — app and website share one origin, so one choice shows in
  // both.
  const signature = signatureStyle(defaultSignature);
  const tenant = brandingStyle(branding);
  const attributes = { ...signature.attributes, ...tenant.attributes };
  const properties = { ...signature.properties, ...tenant.properties };

  return (
    <html lang={locale} style={properties as CSSProperties} {...attributes} suppressHydrationWarning>
      <head>
        <script
          type="application/json"
          id="digita-identity"
          dangerouslySetInnerHTML={{ __html: jsonForScript({ signatures: [defaultSignature], branding }) }}
        />
        <script dangerouslySetInnerHTML={{ __html: IDENTITY_BOOT_SCRIPT }} />
      </head>
      <body className="bg-background text-textMain antialiased">
        <ConfigProvider value={publicConfig()}>
          <div className="relative isolate flex min-h-screen flex-col">
            <SignatureBackdrop graphics={defaultSignature.graphics} />
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-btn focus:bg-primary-600 focus:px-3 focus:py-2 focus:text-sm focus:text-onPrimary"
            >
              {t(locale as Locale, "skipToContent")}
            </a>
            <Header
              locale={locale as Locale}
              site={site}
              nav={headerNav}
              apps={getConfig().tenantApps}
              brand={{
                name: branding?.app_name ?? site?.site_name ?? "Digita",
                logoUrl: branding?.logo ? mediaUrl(branding.logo) : undefined,
                nameIsCustom: Boolean(branding?.app_name),
                signature: defaultSignature,
              }}
            />
            <main id="main" className="flex-1">
              {children}
            </main>
            <Footer locale={locale as Locale} site={site} nav={footerNav} />
          </div>
        </ConfigProvider>
      </body>
    </html>
  );
}
