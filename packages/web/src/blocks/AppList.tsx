import { Card, buttonAttributes } from "@digitaplatform/components";
import { getConfig } from "@/config/env";
import type { Locale } from "@/i18n/config";
import { t } from "@/i18n/messages";
import { type P, Section, cardClass, columnsFor, list, s } from "./marketing/shared";

/** An app's name in words, as "time-tracking" reads "Time tracking", for a card the block gives no
 *  title: the visitor reads words, not the path segment the app is served at. */
function readableAppName(app: string): string {
  const words = app.split(/[-_\s]+/).filter(Boolean).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * One card per app of the tenant, from the list the header links (TENANT_APPS), so an app the
 * tenant adds appears after its next rollout with no change to the site. A card takes its title
 * and description from the block's texts for that app, in the page's language, and shows the
 * app's name in words where the block has none. Its link enters the app at /<app>/, which is no
 * page of the site and so stays out of the page's locale. On a demo tenant a second link opens the
 * tenant IdP's one-click entry, which signs the visitor in as the demo user and goes on to the
 * app. A renderer that is not told the tenant's apps (a tenant routed by host, a site on its own
 * domain) does not know them, and says so.
 */
export function AppList({ props, locale }: { props?: P; locale: Locale }) {
  const { tenantApps, authUrl, demoTenant } = getConfig();
  const texts = new Map(list(props, "apps").map((item) => [s(item, "app"), item]));
  const openLabel = s(props, "link_label") || t("appListOpen", locale);
  const demoLabel = s(props, "demo_label") || t("appListDemo", locale);
  return (
    <Section eyebrow={s(props, "eyebrow")} heading={s(props, "heading")} lede={s(props, "lede")}>
      {tenantApps.length ? (
        <ul className={`grid gap-5 ${columnsFor(tenantApps.length)}`}>
          {tenantApps.map((app) => {
            const text = texts.get(app);
            const description = s(text, "description");
            return (
              <li key={app} className="flex">
                <Card variant="default" className={`${cardClass} w-full`}>
                  <h3 className="font-display text-xl font-semibold text-textMain [overflow-wrap:anywhere]">{s(text, "title") || readableAppName(app)}</h3>
                  {description && <p className="text-sm leading-relaxed text-textMuted">{description}</p>}
                  <div className="mt-auto flex flex-wrap gap-3 pt-2">
                    {demoTenant && authUrl && (
                      <a href={`${authUrl}/demo-login?redirect=${encodeURIComponent(`/${app}/`)}`} {...buttonAttributes()}>
                        {demoLabel}
                      </a>
                    )}
                    <a href={`/${app}/`} {...buttonAttributes({ variant: demoTenant && authUrl ? "outline" : "primary" })}>
                      {openLabel}
                    </a>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-textMuted">{t("appListUnknown", locale)}</p>
      )}
    </Section>
  );
}
