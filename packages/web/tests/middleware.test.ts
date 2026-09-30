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
  delete process.env.AUTH_URL;
  delete process.env.CONTENT_SECURITY_POLICY_HOSTS;
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

/** The directives of a policy, by name. */
const directives = (policy: string | null) =>
  new Map((policy ?? "").split(";").map((d) => d.trim().split(/\s+/)).map(([name = "", ...sources]) => [name, sources]));

/** What is wrong with a page answer's policy: empty when scripts run only with the request's nonce and no site frames the page. */
function policyFaults(res: NextResponse): string[] {
  const policy = res.headers.get("content-security-policy");
  const nonce = res.headers.get("x-middleware-request-x-nonce");
  const faults: string[] = [];
  if (!policy) return ["no policy on the answer"];
  if (!nonce) faults.push("no nonce on the request");
  if (res.headers.get("x-middleware-request-content-security-policy") !== policy) faults.push("the request carries another policy");
  const d = directives(policy);
  const scripts = d.get("script-src") ?? [];
  if (scripts.join(" ") !== `'nonce-${nonce}' 'strict-dynamic'`) faults.push(`script-src is ${scripts.join(" ")}`);
  if ((d.get("frame-ancestors") ?? []).join(" ") !== "'none'") faults.push("frame-ancestors is not 'none'");
  if ((d.get("object-src") ?? []).join(" ") !== "'none'") faults.push("object-src is not 'none'");
  return faults;
}

describe("the security headers", () => {
  const page = "https://example.com/de/about";
  it.each([
    ["a page with a locale", "https://example.com/de/about"],
    ["a bare page", "https://example.com/about"],
    ["the API", "https://example.com/api/contact"],
  ])("send %s a policy under which only a script with the request's nonce runs and no site frames it", (_name, url) => {
    expect(policyFaults(run(url))).toEqual([]);
  });

  it("make a new nonce for every request", () => {
    const nonces = [run(page), run(page)].map((res) => res.headers.get("x-middleware-request-x-nonce"));
    expect(nonces[0]).toBeTruthy();
    expect(nonces[0]).not.toBe(nonces[1]);
  });

  it("PLANTED DEFECT: a policy that lets inline scripts run, a fixed nonce and a page anybody may frame each fail the check above", () => {
    const withPolicy = (edit: (policy: string) => string) => {
      const res = run(page);
      const policy = edit(res.headers.get("content-security-policy") ?? "");
      res.headers.set("content-security-policy", policy);
      res.headers.set("x-middleware-request-content-security-policy", policy);
      return res;
    };
    expect(policyFaults(withPolicy((p) => p.replace("'strict-dynamic'", "'strict-dynamic' 'unsafe-inline'")))).not.toEqual([]);
    expect(policyFaults(withPolicy((p) => p.replace(/'nonce-[^']*'/, "'nonce-fixed'")))).not.toEqual([]);
    expect(policyFaults(withPolicy((p) => p.replace("; frame-ancestors 'none'", "")))).not.toEqual([]);
  });

  it("let images and frames come from any https host, as an editor may point an image or an embed at one", () => {
    const d = directives(run(page).headers.get("content-security-policy"));
    // A signature's backdrop graphics are data: images; without data: the site loses its backdrop.
    expect(d.get("img-src")).toEqual(["'self'", "https:", "data:"]);
    expect(d.get("frame-src")).toEqual(["'self'", "https:"]);
  });

  it("let the page connect to its own origin, the identity provider and the named hosts, and nowhere else", () => {
    expect(directives(run(page).headers.get("content-security-policy")).get("connect-src")).toEqual(["'self'"]);
    process.env.AUTH_URL = "https://auth.example.com/";
    process.env.CONTENT_SECURITY_POLICY_HOSTS = " https://pay.example.net, https://api.example.org:8443 ,";
    expect(directives(run(page).headers.get("content-security-policy")).get("connect-src")).toEqual([
      "'self'",
      "https://auth.example.com",
      "https://pay.example.net",
      "https://api.example.org:8443",
    ]);
  });

  it.each(["https://pay.example.net/checkout", "https://pay.example.net; script-src *", "pay.example.net"])(
    "refuse a named host that is not an origin, such as %s, since it lands in the policy as written",
    (entry) => {
      process.env.CONTENT_SECURITY_POLICY_HOSTS = entry;
      expect(() => run(page)).toThrow("CONTENT_SECURITY_POLICY_HOSTS");
    },
  );

  it("refuse an AUTH_URL that is not a URL, on every path, and name the setting", () => {
    process.env.AUTH_URL = "auth.example.com";
    expect(() => run(page)).toThrow("env var AUTH_URL must be a URL");
    expect(() => run("https://example.com/robots.txt")).toThrow("env var AUTH_URL must be a URL");
  });

  it("let the development server evaluate code, and production never", () => {
    const scripts = () => directives(run(page).headers.get("content-security-policy")).get("script-src");
    expect(scripts()).not.toContain("'unsafe-eval'");
    const nodeEnv = process.env.NODE_ENV;
    try {
      (process.env as Record<string, string>).NODE_ENV = "development";
      expect(scripts()).toContain("'unsafe-eval'");
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnv;
    }
  });

  it("keep a browser on https for a year when the site is served over https", () => {
    expect(run(page).headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(run("https://example.com/about").headers.get("strict-transport-security")).toBe("max-age=31536000");
  });

  it("PLANTED INNOCENT: a site served over http sends no transport rule and keeps its policy", () => {
    process.env.SITE_URL = "http://example.com";
    const res = run("http://example.com/de/about");
    expect(res.headers.get("strict-transport-security")).toBeNull();
    expect(policyFaults(res)).toEqual([]);
  });

  it("PLANTED INNOCENT: overwrite a nonce the client sent", () => {
    expect(run(page, { "x-nonce": "chosen" }).headers.get("x-middleware-request-x-nonce")).not.toBe("chosen");
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
