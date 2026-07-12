import { describe, it, expect } from "vitest";
import { dbName } from "../src/core/config/db-names.js";

describe("dbName — tenant/app-namespaced physical DB names", () => {
  it("composes digita_<guid>_<app>_<suffix> when tenant + app are set", () => {
    expect(dbName("digita", "tk7m3qp9x2vr", "erp", "core")).toBe("digita_tk7m3qp9x2vr_erp_core");
    expect(dbName("digita", "tk7m3qp9x2vr", "erp", "sales")).toBe("digita_tk7m3qp9x2vr_erp_sales");
    expect(dbName("digita", "tk7m3qp9x2vr", "erp", "auth")).toBe("digita_tk7m3qp9x2vr_erp_auth");
  });

  it("drops the tenant slot for legacy single-tenant deployments (app only)", () => {
    expect(dbName("digita", "", "erp", "core")).toBe("digita_erp_core");
    expect(dbName("digita", "", "web", "core")).toBe("digita_web_core");
  });

  it("does not double the app name for domain targets (app already in the slug)", () => {
    // App/domain DB targets are `<app>_<domain>` (e.g. erp_sales); the resolver
    // passes an empty appName so only the guid is prepended — see mongodb-service.
    expect(dbName("digita", "tk7m3qp9x2vr", "", "erp_sales")).toBe("digita_tk7m3qp9x2vr_erp_sales");
    expect(dbName("digita", "", "", "erp_sales")).toBe("digita_erp_sales");
  });

  it("falls back to legacy unprefixed names when neither tenant nor app is set", () => {
    expect(dbName("digita", "", "", "core")).toBe("digita_core");
    expect(dbName("digita", "", "", "logs")).toBe("digita_logs");
  });

  it("honours a custom platform prefix", () => {
    expect(dbName("acme", "tx9", "web", "core")).toBe("acme_tx9_web_core");
  });
});
