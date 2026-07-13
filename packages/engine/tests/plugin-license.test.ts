import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// plugin-license.ts imports the env module (whose real form requires
// MONGODB_URI at import time) — mock it empty: every license env key is
// OPTIONAL and an absent key must read as "not configured".
vi.mock("../src/core/config/env.js", () => ({ env: {} }));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPair, exportSPKI, SignJWT } from "jose";
import {
  verifyPluginLicense,
  loadPluginEntitlements,
  LICENSE_ISSUER,
} from "../src/core/plugins/plugin-license.js";

type LicenseKeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

let tmp: string;
let pem: string;
let otherPem: string;
let keys: LicenseKeyPair;
let pemFile: string;

/** Mint a license JWT with full control over the claims. */
async function mintLicense(opts: {
  issuer?: string;
  plugins?: unknown;
  expiresInSec?: number;
  key?: LicenseKeyPair["privateKey"];
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({ plan: "premium", plugins: opts.plugins ?? ["editorial", "fluent"] })
    .setProtectedHeader({ alg: "EdDSA" })
    .setIssuer(opts.issuer ?? LICENSE_ISSUER)
    .setSubject("tenant-1")
    .setIssuedAt(now - 60)
    .setExpirationTime(now + (opts.expiresInSec ?? 3600));
  return jwt.sign(opts.key ?? keys.privateKey);
}

beforeAll(async () => {
  keys = await generateKeyPair("EdDSA", { extractable: true });
  pem = await exportSPKI(keys.publicKey);
  const other = await generateKeyPair("EdDSA", { extractable: true });
  otherPem = await exportSPKI(other.publicKey);

  tmp = mkdtempSync(join(tmpdir(), "digita-plugin-license-"));
  pemFile = join(tmp, "pub.pem");
  writeFileSync(pemFile, pem, "utf-8");
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("verifyPluginLicense — offline EdDSA verification", () => {
  it("accepts a valid license and extracts tenant/plan/entitlements (deduped)", async () => {
    const jwt = await mintLicense({ plugins: ["editorial", "fluent", "editorial"] });
    const license = await verifyPluginLicense(jwt, pem);
    expect(license.tenant).toBe("tenant-1");
    expect(license.plan).toBe("premium");
    expect(license.entitlements).toEqual(["editorial", "fluent"]);
  });

  it("rejects a license from a different issuer", async () => {
    const jwt = await mintLicense({ issuer: "someone-else" });
    await expect(verifyPluginLicense(jwt, pem)).rejects.toThrow();
  });

  it("rejects an expired license", async () => {
    const jwt = await mintLicense({ expiresInSec: -30 });
    await expect(verifyPluginLicense(jwt, pem)).rejects.toThrow();
  });

  it("rejects a license signed with a different key", async () => {
    const jwt = await mintLicense({});
    await expect(verifyPluginLicense(jwt, otherPem)).rejects.toThrow();
  });

  it("treats a malformed plugins claim as zero entitlements", async () => {
    const jwt = await mintLicense({ plugins: "editorial,fluent" });
    const license = await verifyPluginLicense(jwt, pem);
    expect(license.entitlements).toEqual([]);
  });

  it("filters non-string entries out of the plugins claim", async () => {
    const jwt = await mintLicense({ plugins: ["editorial", 42, null, "", "fluent"] });
    const license = await verifyPluginLicense(jwt, pem);
    expect(license.entitlements).toEqual(["editorial", "fluent"]);
  });
});

describe("loadPluginEntitlements — fail-closed, never throws", () => {
  it("returns the entitlements for a valid inline license", async () => {
    const jwt = await mintLicense({});
    const out = await loadPluginEntitlements({ license: jwt, licenseFile: "", pubkeyFile: pemFile });
    expect(out).toEqual(["editorial", "fluent"]);
  });

  it("reads the license from a file when no inline JWT is set", async () => {
    const jwt = await mintLicense({});
    const licFile = join(tmp, "license.jwt");
    writeFileSync(licFile, jwt + "\n", "utf-8");
    const out = await loadPluginEntitlements({ license: "", licenseFile: licFile, pubkeyFile: pemFile });
    expect(out).toEqual(["editorial", "fluent"]);
  });

  it("returns [] when nothing is configured", async () => {
    const out = await loadPluginEntitlements({ license: "", licenseFile: "", pubkeyFile: "" });
    expect(out).toEqual([]);
  });

  it("returns [] when the license file is missing", async () => {
    const out = await loadPluginEntitlements({
      license: "",
      licenseFile: join(tmp, "does-not-exist.jwt"),
      pubkeyFile: pemFile,
    });
    expect(out).toEqual([]);
  });

  it("returns [] when the public key file is missing", async () => {
    const jwt = await mintLicense({});
    const out = await loadPluginEntitlements({
      license: jwt,
      licenseFile: "",
      pubkeyFile: join(tmp, "no-key.pem"),
    });
    expect(out).toEqual([]);
  });

  it("returns [] for an invalid/garbage license", async () => {
    const out = await loadPluginEntitlements({
      license: "not.a.jwt",
      licenseFile: "",
      pubkeyFile: pemFile,
    });
    expect(out).toEqual([]);
  });

  it("returns [] for an expired license", async () => {
    const jwt = await mintLicense({ expiresInSec: -30 });
    const out = await loadPluginEntitlements({ license: jwt, licenseFile: "", pubkeyFile: pemFile });
    expect(out).toEqual([]);
  });

  it("reads absent env keys as not-configured (mocked whole-env safety)", async () => {
    // env is mocked as {} above — no overrides at all must still be safe.
    const out = await loadPluginEntitlements();
    expect(out).toEqual([]);
  });
});
