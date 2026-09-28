// The privacy page says a followed link sends nothing to the other site; only a
// Referrer-Policy header on every response makes that true.
import { describe, it, expect } from "vitest";
import type { NextConfig } from "next";
import nextConfig from "../next.config";

async function referrerPolicyFor(config: NextConfig) {
  const rules = (await config.headers?.()) ?? [];
  return rules
    .filter((rule) => rule.source === "/:path*")
    .flatMap((rule) => rule.headers)
    .find((header) => header.key === "Referrer-Policy")?.value;
}

describe("Referrer-Policy header", () => {
  it("is no-referrer on every path", async () => {
    expect(await referrerPolicyFor(nextConfig)).toBe("no-referrer");
  });

  const { headers: _dropped, ...withoutHeader } = nextConfig;
  const withPolicy = (source: string, value: string): NextConfig => ({
    ...nextConfig,
    headers: async () => [{ source, headers: [{ key: "Referrer-Policy", value }] }],
  });
  it.each([
    ["no header", withoutHeader],
    ["wrong value", withPolicy("/:path*", "strict-origin-when-cross-origin")],
    ["one locale only", withPolicy("/en/:path*", "no-referrer")],
  ])("PLANTED DEFECT: %s fails the assertion above", async (_name, config) => {
    expect(await referrerPolicyFor(config)).not.toBe("no-referrer");
  });
});
