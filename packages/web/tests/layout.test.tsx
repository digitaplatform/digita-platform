// The locale layout leaves the bare URL's language negotiation to the pages, links the
// tenant's apps in the header unless the site turns them off, so a WebSite row written before
// `link_apps` existed keeps the apps it linked, and hands the pre-paint boot the site's signature.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { WebSite } from "../src/lib/types";

vi.mock("server-only", () => ({}));
vi.mock("../src/i18n/messages", () => ({ t: (key: string) => key }));
const redirect = vi.fn((url: string): never => {
  throw new Error(`redirect ${url}`);
});
vi.mock("next/navigation", () => ({
  notFound: () => {},
  redirect: (url: string) => redirect(url),
  usePathname: () => "/",
  useRouter: () => ({ push: () => {} }),
}));
let requestHeaders: Record<string, string> = {};
let localeCookie: string | undefined;
vi.mock("next/headers", () => ({
  headers: async () => new Headers(requestHeaders),
  cookies: async () => ({ get: (name: string) => (name === "locale" && localeCookie ? { name, value: localeCookie } : undefined) }),
}));

let site: WebSite;
let publishedSlugs: Record<string, string[]> = { en: [""], de: [""] };
vi.mock("../src/lib/engine-client", () => ({
  getSite: async () => site,
  getNav: async () => null,
  getBranding: async () => null,
  listPublishedSlugs: async () => publishedSlugs,
}));

Object.assign(process.env, {
  ENGINE_URL: "http://engine.internal:3000",
  SITE_ID: "example",
  SITE_URL: "https://example.org",
  PUBLIC_ENGINE_URL: "",
  REVALIDATE_SECONDS: "60",
  REVALIDATE_SECRET: "test-revalidate-secret",
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
  publishedSlugs = { en: [""], de: [""] };
  requestHeaders = { "x-nonce": "bm9uY2U=" };
  localeCookie = undefined;
  redirect.mockClear();
});

describe("the locale layout", () => {
  it("PLANTED INNOCENT: never negotiates a bare URL itself, because a soft navigation keeps the layout and would skip it", async () => {
    requestHeaders = { ...requestHeaders, "x-locale-negotiable": "/", "accept-language": "de" };
    expect(await render()).toContain('lang="en"');
    expect(redirect).not.toHaveBeenCalled();
  });

  it("PLANTED DEFECT: hands the header the engine's published pages, so a locale without a published home is not offered", async () => {
    publishedSlugs = { en: [""] };
    // A layout that offered every served locale would render the menu here; this goes red then.
    expect(await render()).not.toContain('aria-label="language"');
    publishedSlugs = { en: [""], de: [""] };
    expect(await render()).toContain('aria-label="language"');
  });

  it("hands the header the site's enabled locales, so a site that enables one locale shows no menu", async () => {
    site = { ...site, enabled_locales: ["en"] };
    expect(await render()).not.toContain('aria-label="language"');
  });

  it("links the tenant's apps for a site row without link_apps", async () => {
    // PLANTED DEFECT: reading a missing field as false drops the apps, and this goes red.
    expect(await render()).toContain('href="/crm/"');
  });

  it("PLANTED INNOCENT: hides the tenant's apps when the site sets link_apps to false", async () => {
    site = { ...site, link_apps: false };
    expect(await render()).not.toContain('href="/crm/"');
  });

  it("declares the site's signature again for a dark band, so the band keeps the site's own colors", async () => {
    site = { ...site, theme: "simetrix" };
    const html = await render();
    const style = /<html[^>]* style="([^"]*)"/.exec(html)![1]!
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&");
    const band = /<style>:root \[data-block\]\[data-variant="dark"\] \{ ([^}]*) \}<\/style>/.exec(html);
    // A layout without the band rule leaves the band to the design's dark tokens; this goes red then.
    expect(band).not.toBeNull();
    const inline = style.split(";").filter((d) => d.startsWith("--"));
    expect(inline.length).toBeGreaterThan(10);
    for (const declaration of inline) {
      const [name, value] = [declaration.slice(0, declaration.indexOf(":")), declaration.slice(declaration.indexOf(":") + 1)];
      expect(band![1]).toContain(`${name}: ${value} !important;`);
    }
  });

  it("hands the pre-paint boot the site's signature, so a stored one does not replace it", async () => {
    site = { ...site, theme: "simetrix" };
    const html = await render();
    expect(html).toContain('data-signature="simetrix"');
    // A page identity without `signature` lets the boot resolve the stored id; this goes red then.
    expect(html).toContain('"signature":"simetrix"');
  });

  it("runs the pre-paint boot under the policy, with the request's nonce", async () => {
    // Every script that runs (a data block never does) carries the nonce. A boot script without it
    // is blocked by the policy; this goes red then.
    expect((await render()).match(/<script(?![^>]*type="application\/(ld\+)?json")[^>]*>/g)).toEqual(['<script nonce="bm9uY2U=">']);
  });

  it("PLANTED DEFECT: refuses a request the middleware did not give a nonce, instead of writing a script the policy blocks", async () => {
    requestHeaders = {};
    await expect(render()).rejects.toThrow("x-nonce");
  });
});
