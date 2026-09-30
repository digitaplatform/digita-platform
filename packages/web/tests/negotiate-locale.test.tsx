// Every page sends a browser that prefers another published locale from the bare URL to that
// locale's URL of the same page, the query kept, on a hard load and on a link click alike.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { WebSite } from "../src/lib/types";

vi.mock("server-only", () => ({}));
vi.mock("../src/components/PageView", () => ({ PageView: () => "the page" }));
const redirect = vi.fn((url: string): never => {
  throw new Error(`redirect ${url}`);
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
  redirect: (url: string) => redirect(url),
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
  getPage: async (locale: string, slug: string) => (publishedSlugs[locale]?.includes(slug) ? { _id: `example::${locale}::${slug}` } : null),
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
});

const { default: HomePage } = await import("../src/app/[locale]/page");
const { default: ContentPage } = await import("../src/app/[locale]/[...slug]/page");

async function renderHome(): Promise<string> {
  return renderToStaticMarkup(await HomePage({ params: Promise.resolve({ locale: "en" }) }));
}
async function renderContent(slug: string[]): Promise<string> {
  return renderToStaticMarkup(await ContentPage({ params: Promise.resolve({ locale: "en", slug }) }));
}
const bare = (path: string, acceptLanguage: string) => {
  requestHeaders = { "x-locale-negotiable": path, "accept-language": acceptLanguage };
};

beforeEach(() => {
  site = { _id: "example", site_name: "example", domain: "example.org" };
  publishedSlugs = { en: [""], de: [""] };
  requestHeaders = {};
  localeCookie = undefined;
  redirect.mockClear();
});

describe("the bare URL", () => {
  it("PLANTED DEFECT: the home page sends a browser that prefers German to the German home", async () => {
    bare("/", "de-CH,de;q=0.9,en;q=0.8");
    // A page that renders the default locale to every browser never redirects, and this goes red.
    await expect(renderHome()).rejects.toThrow("redirect /de");
    expect(redirect).toHaveBeenCalledWith("/de");
  });

  it("a content page keeps the page the visitor asked for, and its query", async () => {
    publishedSlugs = { en: ["", "about"], de: ["", "about"] };
    bare("/about", "de");
    await expect(renderContent(["about"])).rejects.toThrow("redirect /de/about");
    bare("/about?utm_source=newsletter&x=1", "de");
    await expect(renderContent(["about"])).rejects.toThrow("redirect /de/about?utm_source=newsletter&x=1");
  });

  it("renders for a browser that prefers the default locale, and for one that prefers no offered language", async () => {
    bare("/", "en-US,en;q=0.9,de;q=0.8");
    expect(await renderHome()).toBe("the page");
    bare("/", "fr-FR,fr;q=0.9");
    expect(await renderHome()).toBe("the page");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("lets the visitor's own pick win over the browser: a locale cookie is followed, an unknown one ignored", async () => {
    bare("/", "de");
    localeCookie = "en";
    expect(await renderHome()).toBe("the page");
    bare("/", "en");
    localeCookie = "de";
    await expect(renderHome()).rejects.toThrow("redirect /de");
    bare("/", "de");
    localeCookie = "fr";
    await expect(renderHome()).rejects.toThrow("redirect /de");
  });

  it("PLANTED INNOCENT: a prefixed URL never redirects, whatever the browser prefers", async () => {
    requestHeaders = { "accept-language": "de" };
    expect(await renderHome()).toBe("the page");
    publishedSlugs = { en: ["", "about"], de: ["", "about"] };
    expect(await renderContent(["about"])).toBe("the page");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("renders when the page is not published in the browser's language, a draft or another slug", async () => {
    publishedSlugs = { en: ["", "about"], de: [""] };
    bare("/about", "de");
    expect(await renderContent(["about"])).toBe("the page");
    publishedSlugs = { en: [""] };
    bare("/", "de");
    expect(await renderHome()).toBe("the page");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("renders when the site does not enable the browser's language", async () => {
    site = { ...site, enabled_locales: ["en"] };
    bare("/", "de");
    expect(await renderHome()).toBe("the page");
    expect(redirect).not.toHaveBeenCalled();
  });
});
