// The URL rules: a bare path serves the default locale under the same URL, the www and the bare
// form of the canonical host move to the canonical host, and every link the site builds follows
// the same rule.
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { config, middleware } from "../src/middleware";
import { localeHref, navHref, switchLocalePath } from "../src/lib/nav";

beforeEach(() => {
  process.env.LOCALES = "en,de";
  process.env.DEFAULT_LOCALE = "en";
  process.env.SITE_URL = "https://example.com";
});

const run = (url: string) => middleware(new NextRequest(url));

describe("the middleware", () => {
  it.each([
    ["https://example.com/", "https://example.com/en"],
    ["https://example.com/about", "https://example.com/en/about"],
  ])("serves %s as the default locale's page, under the same URL", (url, target) => {
    const res = run(url);
    // PLANTED DEFECT: a redirect answers 307 with a location, and this goes red.
    expect(res?.status).toBe(200);
    expect(res?.headers.get("location")).toBeNull();
    expect(res?.headers.get("x-middleware-rewrite")).toBe(target);
  });

  it("moves the www host to the canonical apex host for good, on every path", () => {
    for (const path of ["/x", "/sitemap.xml", "/robots.txt", "/api/contact"]) {
      const res = run(`https://www.example.com${path}`);
      expect(res?.status).toBe(301);
      expect(res?.headers.get("location")).toBe(`https://example.com${path}`);
    }
  });

  it("runs on every path but Next's own assets, so the host rule reaches the API and the files", () => {
    // Next compiles each matcher entry to an anchored regular expression; this one is plain regex.
    const matches = (path: string) => config.matcher.some((m) => new RegExp(`^${m}$`).test(path));
    for (const path of ["/", "/about", "/sitemap.xml", "/robots.txt", "/api/contact"]) expect(matches(path)).toBe(true);
    expect(matches("/_next/static/app.js")).toBe(false);
  });

  it("moves the apex host to the canonical www host for good, the path kept", () => {
    process.env.SITE_URL = "https://www.example.com";
    const res = run("https://example.com/about");
    expect(res?.status).toBe(301);
    expect(res?.headers.get("location")).toBe("https://www.example.com/about");
  });

  it("sends the visitor to the host they asked for, over their protocol, not to the pod's port", () => {
    const headers = { host: "www.example.com", "x-forwarded-proto": "https" };
    const res = middleware(new NextRequest("http://www.example.com:3001/x?a=1", { headers }));
    expect(res?.headers.get("location")).toBe("https://example.com/x?a=1");
  });

  it("PLANTED INNOCENT: leaves a host that is not a form of the canonical host alone", () => {
    expect(run("https://other.example.org/sitemap.xml")).toBeUndefined();
    expect(run("https://www.other.example.org/api/contact")).toBeUndefined();
    expect(run("https://other.example.org/about")?.headers.get("location")).toBeNull();
  });

  it("serves the API and the files on the canonical host as they are", () => {
    expect(run("https://example.com/sitemap.xml")).toBeUndefined();
    expect(run("https://example.com/api/contact")).toBeUndefined();
  });

  it("PLANTED INNOCENT: leaves a path with a locale alone", () => {
    expect(run("https://example.com/de/about")).toBeUndefined();
    expect(run("https://example.com/de")).toBeUndefined();
  });
});

describe("the links the site builds", () => {
  it("leaves the default locale bare and puts the others under their prefix", () => {
    expect(navHref("en", "en", { label: "About", href: "/about" })).toBe("/about");
    expect(navHref("de", "en", { label: "About", href: "/about" })).toBe("/de/about");
    expect(navHref("de", "en", { label: "Home", page: "site::de::" })).toBe("/de");
    expect(navHref("en", "en", { label: "Home", page: "site::en::" })).toBe("/");
    expect(navHref("de", "en", { label: "Cloud" })).toBeNull();
  });

  it("passes a URL with a scheme and an anchor through", () => {
    for (const href of ["https://example.org", "mailto:hello@example.org", "tel:+41", "#contact"]) {
      expect(localeHref("de", "en", href)).toBe(href);
    }
  });

  it("switches the locale of the page the browser shows", () => {
    expect(switchLocalePath("/about", "de", ["en", "de"], "en")).toBe("/de/about");
    expect(switchLocalePath("/de/about", "en", ["en", "de"], "en")).toBe("/about");
    expect(switchLocalePath("/de", "en", ["en", "de"], "en")).toBe("/");
    expect(switchLocalePath("/", "de", ["en", "de"], "en")).toBe("/de");
  });
});
