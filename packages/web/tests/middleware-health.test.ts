import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../src/middleware";

beforeEach(() => {
  vi.stubEnv("SITE_URL", "https://example.com");
  vi.stubEnv("LOCALES", "en,de");
  vi.stubEnv("DEFAULT_LOCALE", "en");
  vi.stubEnv("AUTH_URL", "");
  vi.stubEnv("CONTENT_SECURITY_POLICY_HOSTS", "");
  vi.stubEnv("VERSION_ENDPOINTS", "");
});

afterEach(() => vi.unstubAllEnvs());

describe("health locale bypass", () => {
  it.each(["/health", "/health?probe=ready"])(
    "passes %s anonymously without locale negotiation",
    (path) => {
      const response = middleware(new NextRequest(`https://example.com${path}`, {
        headers: {
          "accept-language": "de",
          "x-locale-negotiable": "/forged",
        },
      }));

      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
      expect(response.headers.get("x-middleware-request-x-locale-negotiable")).toBeNull();
      expect(response.headers.get("content-security-policy")).toBeTruthy();
    },
  );

  it.each([
    ["/", "/en"],
    ["/about?from=footer", "/en/about?from=footer"],
    ["/health-check", "/en/health-check"],
  ])("still rewrites ordinary page %s to %s", (path, target) => {
    const response = middleware(new NextRequest(`https://example.com${path}`));

    expect(response.headers.get("x-middleware-rewrite"))
      .toBe(`https://example.com${target}`);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-locale-negotiable"))
      .toBe(path);
    expect(response.headers.get("vary")).toBe("Accept-Language, Cookie");
  });

  it("still passes an explicitly localized page", () => {
    const response = middleware(new NextRequest("https://example.com/de/about"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });
});
