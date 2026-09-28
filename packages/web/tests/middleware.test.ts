// The URL rules: a bare path serves the default locale under the same URL, a www host moves to
// its apex, and every link the site builds follows the same rule.
import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../src/middleware";
import { localeHref, navHref, switchLocalePath } from "../src/lib/nav";

beforeAll(() => {
  process.env.LOCALES = "en,de";
  process.env.DEFAULT_LOCALE = "en";
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

  it("moves a www host to the apex host for good, the path kept", () => {
    const res = run("https://www.example.com/x");
    expect(res?.status).toBe(301);
    expect(res?.headers.get("location")).toBe("https://example.com/x");
  });

  it("sends the visitor to the host they asked for, over their protocol, not to the pod's port", () => {
    const headers = { host: "www.example.com", "x-forwarded-proto": "https" };
    const res = middleware(new NextRequest("http://www.example.com:3001/x?a=1", { headers }));
    expect(res?.headers.get("location")).toBe("https://example.com/x?a=1");
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
