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

  it("PLANTED DEFECT: a config without the header has no policy", async () => {
    const { headers: _dropped, ...withoutHeader } = nextConfig;
    expect(await referrerPolicyFor(withoutHeader)).toBeUndefined();
  });
});
