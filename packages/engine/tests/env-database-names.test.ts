// A tenant engine opens exactly the databases its chart's ServiceClaim grants. The chart hands
// them over as MONGODB_DATABASE_NAMES; composing them from TENANT_ID, APP_NAME and STAGE instead
// is how a website member once opened a database nobody granted.
import { afterEach, describe, expect, it, vi } from "vitest";

const granted = {
  core: "g1_erp_core_prod",
  logs: "g1_erp_logs_prod",
  audits: "g1_erp_audits_prod",
  auth: "g1_erp_auth_prod",
  sales: "g1_erp_sales_prod",
};
const base = { MONGODB_URI: "mongodb://localhost:27017", TRANSLATIONS_DIR: "/translations" };
const tenant = { ...base, TENANT_ID: "g1", APP_NAME: "erp", STAGE: "prod" };

/** env.ts read afresh with these variables; it composes its values once at module scope. */
async function envWith(vars: Record<string, string>) {
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
  vi.resetModules();
  return (await import("../src/core/config/env.js")).env;
}

afterEach(() => vi.unstubAllEnvs());

describe("a tenant engine's database names", () => {
  it("come from MONGODB_DATABASE_NAMES, whatever TENANT_ID, APP_NAME and STAGE say", async () => {
    const env = await envWith({ ...tenant, APP_NAME: "another-member", MONGODB_DATABASE_NAMES: JSON.stringify(granted) });
    expect([env.MONGODB_CORE_DB, env.MONGODB_LOGS_DB, env.MONGODB_AUDITS_DB, env.MONGODB_IDENTITY_DB]).toEqual([
      granted.core,
      granted.logs,
      granted.audits,
      granted.auth,
    ]);
    expect(env.MONGODB_DATABASE_NAMES).toEqual(granted);
  });

  it("stop the start when the grant is missing, naming it", async () => {
    await expect(envWith({ ...tenant, MONGODB_DATABASE_NAMES: "" })).rejects.toThrow(/MONGODB_DATABASE_NAMES/);
  });

  it("stop the start when a reserved database is not granted, naming it", async () => {
    const { auth: _auth, ...withoutAuth } = granted;
    await expect(envWith({ ...tenant, MONGODB_DATABASE_NAMES: JSON.stringify(withoutAuth) })).rejects.toThrow(
      /no database for "auth"/,
    );
  });
});

describe("an engine without a tenant", () => {
  it("composes its database names and has no grant", async () => {
    const env = await envWith({ ...base, TENANT_ID: "", APP_NAME: "erp", STAGE: "", MONGODB_APP_DB_PREFIX: "digita" });
    expect(env.MONGODB_CORE_DB).toBe("digita_erp_core");
    expect(env.MONGODB_IDENTITY_DB).toBe("digita_erp_auth");
    expect(env.MONGODB_DATABASE_NAMES).toBeNull();
  });
});
