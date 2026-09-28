// The URL rules: a bare path serves the default locale under the same URL, the www and the bare
// form of the canonical host move to the canonical host, and every link the site builds follows
// the same rule.
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { config, middleware } from "../src/middleware";
import { localeHref, navHref, switchLocalePath } from "../src/lib/nav";

beforeEach(() => {
  process.env.LOCALES = "en,de";
  process.env.DEFAULT_LOCALE = "en";
  process.env.SITE_URL = "https://example.com";
});

const run = (url: string, headers?: Record<string, string>) => middleware(new NextRequest(url, { headers }));
/** The request goes on to its own route: no other URL, no other page. */
const passes = (res: NextResponse) => res.status === 200 && !res.headers.get("location") && !res.headers.get("x-middleware-rewrite");

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

  it("marks a bare page request as negotiable, with the visitor's path and query, and its answer as varying by language", () => {
    const res = run("https://example.com/about");
    expect(res.headers.get("x-middleware-request-x-locale-negotiable")).toBe("/about");
    expect(res.headers.get("vary")).toBe("Accept-Language, Cookie");
    // PLANTED DEFECT: a mark that carries the path alone loses a campaign's query, and this goes red.
    expect(run("https://example.com/about?utm_source=newsletter&x=1").headers.get("x-middleware-request-x-locale-negotiable")).toBe(
      "/about?utm_source=newsletter&x=1",
    );
  });

  it("PLANTED DEFECT: drops a negotiable mark the client sent, so a prefixed URL, the API and a file never negotiate", () => {
    // A middleware that passes a prefixed request untouched forwards the smuggled mark, and this goes red.
    for (const url of ["https://example.com/de/about", "https://example.com/de", "https://example.com/api/contact", "https://example.com/sitemap.xml"]) {
      const res = run(url, { "x-locale-negotiable": "/about", "accept-language": "de" });
      expect(passes(res)).toBe(true);
      expect(res.headers.get("x-middleware-request-x-locale-negotiable")).toBeNull();
      expect(res.headers.get("x-middleware-override-headers")?.split(",")).not.toContain("x-locale-negotiable");
      expect(res.headers.get("x-middleware-request-accept-language")).toBe("de");
    }
    // On the bare URL the mark is the middleware's own, not the client's.
    expect(run("https://example.com/about", { "x-locale-negotiable": "/" }).headers.get("x-middleware-request-x-locale-negotiable")).toBe("/about");
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
    expect(passes(run("https://other.example.org/sitemap.xml"))).toBe(true);
    expect(passes(run("https://www.other.example.org/api/contact"))).toBe(true);
    expect(run("https://other.example.org/about").headers.get("location")).toBeNull();
  });

  it("serves the API and the files on the canonical host as they are", () => {
    expect(passes(run("https://example.com/sitemap.xml"))).toBe(true);
    expect(passes(run("https://example.com/api/contact"))).toBe(true);
  });

  it("PLANTED INNOCENT: leaves a path with a locale alone", () => {
    expect(passes(run("https://example.com/de/about"))).toBe(true);
    expect(passes(run("https://example.com/de"))).toBe(true);
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
