// The engine verifies every token against its identity provider, so the provider's settings have no
// development default: a deployment that forgets one stops at start-up and names it.
import { describe, it, expect, vi, afterEach } from "vitest";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
  vi.resetModules();
});

const loadEnv = () => import("../src/core/config/env.js");

describe("the identity provider settings", () => {
  it.each(["AUTH_JWKS_URL", "AUTH_ISSUER", "AUTH_AUDIENCE"])("refuse a start without %s and name it", async (key) => {
    process.env["MONGODB_URI"] ??= "mongodb://127.0.0.1:1";
    delete process.env[key];
    vi.resetModules();
    await expect(loadEnv()).rejects.toMatchObject({ code: "setting_missing", params: { setting: key } });
  });

  it("PLANTED INNOCENT: start with all three and keep their values", async () => {
    process.env["MONGODB_URI"] ??= "mongodb://127.0.0.1:1";
    vi.resetModules();
    const { env } = await loadEnv();
    expect([env.AUTH_JWKS_URL, env.AUTH_ISSUER, env.AUTH_AUDIENCE]).toEqual([
      process.env["AUTH_JWKS_URL"],
      process.env["AUTH_ISSUER"],
      process.env["AUTH_AUDIENCE"],
    ]);
  });
});
