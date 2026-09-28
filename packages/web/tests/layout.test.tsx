// The locale layout links the tenant's apps in the header unless the site turns them off, so a
// WebSite row written before `link_apps` existed keeps the apps it linked.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { WebSite } from "../src/lib/types";

vi.mock("server-only", () => ({}));
vi.mock("../src/i18n/messages", () => ({ t: (key: string) => key }));
vi.mock("next/navigation", () => ({ notFound: () => {}, usePathname: () => "/", useRouter: () => ({ push: () => {} }) }));

let site: WebSite;
vi.mock("../src/lib/engine-client", () => ({
  getSite: async () => site,
  getNav: async () => null,
  getBranding: async () => null,
}));

Object.assign(process.env, {
  ENGINE_URL: "http://engine.internal:3000",
  SITE_ID: "example",
  SITE_URL: "https://example.org",
  PUBLIC_ENGINE_URL: "",
  REVALIDATE_SECONDS: "60",
  TRANSLATIONS_DIR: "/translations",
  LOCALES: "en,de",
  DEFAULT_LOCALE: "en",
  TENANT_APPS: "crm",
});

const { default: LocaleLayout } = await import("../src/app/[locale]/layout");

async function render(): Promise<string> {
  const page = await LocaleLayout({ children: null, params: Promise.resolve({ locale: "en" }) });
  return renderToStaticMarkup(page);
}

beforeEach(() => {
  site = { _id: "example", site_name: "example", domain: "example.org" };
});

describe("the locale layout", () => {
  it("links the tenant's apps for a site row without link_apps", async () => {
    // PLANTED DEFECT: reading a missing field as false drops the apps, and this goes red.
    expect(await render()).toContain('href="/crm/"');
  });

  it("PLANTED INNOCENT: hides the tenant's apps when the site sets link_apps to false", async () => {
    site = { ...site, link_apps: false };
    expect(await render()).not.toContain('href="/crm/"');
  });
});
