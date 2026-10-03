import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "../src/lib/content-security-policy";

function directives(env: Record<string, string | undefined>) {
  return new Map(contentSecurityPolicy("test-nonce", env).split("; ").map((entry) => {
    const [name, ...values] = entry.split(" ");
    return [name, values] as const;
  }));
}

describe("version metadata CSP origins", () => {
  it("adds only explicitly listed origins, strips paths, and deduplicates", () => {
    const policy = directives({
      AUTH_URL: "https://auth.example.com/",
      CONTENT_SECURITY_POLICY_HOSTS: "https://pay.example.com",
      VERSION_ENDPOINTS: [
        "https://auth.example.com/health",
        "https://web.example.com/health",
        "https://web.example.com/health/frontend",
        "http://metadata.example.com:8080/health",
      ].join(","),
      ENGINE_URL: "http://engine.internal:3000",
      ENGINE_URLS: '{"crm":"http://crm.internal:3000"}',
      PUBLIC_ENGINE_URL: "https://media.example.com",
      JOBS_URL: "https://unlisted-jobs.example.com",
      REPORT_URL: "https://unlisted-report.example.com",
    });

    expect(policy.get("connect-src")).toEqual([
      "'self'",
      "https://auth.example.com",
      "https://pay.example.com",
      "https://web.example.com",
      "http://metadata.example.com:8080",
    ]);
    expect(policy.get("script-src")).toEqual([
      "'nonce-test-nonce'", "'strict-dynamic'",
    ]);
  });

  it.each([undefined, ""])("adds no metadata origins for %s", (value) => {
    expect(directives({ VERSION_ENDPOINTS: value }).get("connect-src"))
      .toEqual(["'self'"]);
  });

  it.each([
    "https://good.example/health;script-src *",
    "https://good.example/health https://evil.example",
    "https://good.example/health\nscript-src *",
    "https://good.example/health\r\nscript-src *",
    "https://good.example/health?x=1",
    "https://good.example/health#fragment",
    "https://user:password@good.example/health",
    "https://*.example/health",
    "javascript:alert(1)",
    "data:text/plain,metadata",
    "//good.example/health",
    "https://good.example/health,",
    ",https://good.example/health",
    "https://good.example/health,,https://other.example/health",
  ])("rejects unsafe VERSION_ENDPOINTS value %s", (value) => {
    expect(() => contentSecurityPolicy("test-nonce", {
      VERSION_ENDPOINTS: value,
    })).toThrow("VERSION_ENDPOINTS");
  });
});
