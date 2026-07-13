import { readFile } from "node:fs/promises";
import { importSPKI, jwtVerify } from "jose";
import { env } from "../config/env.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("plugin-license");

/**
 * Offline plugin-license verification. A license is an EdDSA(Ed25519) JWT
 * signed by the licensing authority with claims
 * `{ iss: "digita-licensing", sub: <tenant>, plan, plugins: [<premium ids>], exp }`.
 * The engine verifies it OFFLINE against a configured public key (no network,
 * mirrors the JWKS-offline pattern of the auth boundary) and exposes
 * `claims.plugins` as the tenant's premium ENTITLEMENTS. Everything here is
 * fail-closed: a missing / unreadable / invalid / expired license yields `[]`
 * (premium plugins stay locked) and must NEVER crash boot.
 */

/** Issuer every plugin license must carry (mirrors tools/plugin-mock). */
export const LICENSE_ISSUER = "digita-licensing";

export interface PluginLicense {
  /** Tenant the license was issued to (`sub`). */
  tenant: string;
  plan?: string;
  /** Premium plugin ids this license entitles (deduped `claims.plugins`). */
  entitlements: string[];
}

/**
 * Verify a license JWT against a PEM (SPKI) public key. Enforces EdDSA and the
 * licensing issuer; `exp` is enforced by jwtVerify. THROWS on any problem —
 * callers that must not crash use {@link loadPluginEntitlements}.
 */
export async function verifyPluginLicense(jwt: string, publicKeyPem: string): Promise<PluginLicense> {
  const key = await importSPKI(publicKeyPem, "EdDSA");
  const { payload } = await jwtVerify(jwt, key, {
    issuer: LICENSE_ISSUER,
    algorithms: ["EdDSA"],
  });
  const raw = payload["plugins"];
  const plugins = Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  return {
    tenant: typeof payload.sub === "string" ? payload.sub : "",
    plan: typeof payload["plan"] === "string" ? payload["plan"] : undefined,
    entitlements: Array.from(new Set(plugins)),
  };
}

/**
 * Sources for the license material. Each field independently defaults to the
 * matching env key; injectable so tests can exercise the fail-closed paths
 * without touching process-wide env. Pass an explicit `""` to disable an
 * env fallback.
 */
export interface LicenseSourceOverrides {
  /** The license JWT itself (wins over the file). */
  license?: string;
  /** Path to a file containing the license JWT. */
  licenseFile?: string;
  /** Path to the PEM public key used for offline verification. */
  pubkeyFile?: string;
}

/**
 * Env keys are OPTIONAL: several integration tests replace the whole env
 * object with a fixed key list, so an absent key must read as "not
 * configured" — never a type error or a required-at-import crash.
 */
function envString(v: string | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Load + verify the configured license and return the entitled premium plugin
 * ids. NEVER throws and does no I/O beyond the two configured files:
 *   - license from `DIGITA_PLUGIN_LICENSE` (inline JWT) or
 *     `DIGITA_PLUGIN_LICENSE_FILE` (dev default: the checked-in sample license)
 *   - public key from `DIGITA_PLUGIN_LICENSE_PUBKEY_FILE`
 * Missing/unreadable/invalid/expired anything ⇒ `[]` (fail-closed, logged).
 */
export async function loadPluginEntitlements(
  overrides: LicenseSourceOverrides = {},
): Promise<string[]> {
  const inline = overrides.license ?? envString(env.DIGITA_PLUGIN_LICENSE);
  const licenseFile = overrides.licenseFile ?? envString(env.DIGITA_PLUGIN_LICENSE_FILE);
  const pubkeyFile = overrides.pubkeyFile ?? envString(env.DIGITA_PLUGIN_LICENSE_PUBKEY_FILE);

  let jwt = inline.trim();
  if (!jwt && licenseFile) {
    try {
      jwt = (await readFile(licenseFile, "utf-8")).trim();
    } catch {
      // Expected on installs without a license (incl. prod images that don't
      // ship the dev-sample file) — info, not warn: no license = free tier.
      log.info({ file: licenseFile }, "No plugin license file — premium plugins stay locked");
      return [];
    }
  }
  if (!jwt) {
    log.info("No plugin license configured — premium plugins stay locked");
    return [];
  }
  if (!pubkeyFile) {
    log.warn("Plugin license present but no public key configured — premium plugins stay locked");
    return [];
  }

  let pem: string;
  try {
    pem = await readFile(pubkeyFile, "utf-8");
  } catch (e) {
    log.warn(
      { file: pubkeyFile, err: (e as Error).message },
      "Plugin license public key unreadable — premium plugins stay locked",
    );
    return [];
  }

  try {
    const license = await verifyPluginLicense(jwt, pem);
    log.info(
      { tenant: license.tenant, plan: license.plan, entitlements: license.entitlements },
      "Plugin license verified — premium entitlements active",
    );
    return license.entitlements;
  } catch (e) {
    log.warn(
      { err: (e as Error).message },
      "Plugin license invalid or expired — premium plugins stay locked",
    );
    return [];
  }
}
