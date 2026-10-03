import { describe, it, expect } from "vitest";
import { grantedDatabaseName, parseDatabaseNames } from "../src/core/config/db-names.js";

describe("parseDatabaseNames", () => {
  it("reads the suffix-to-name map the chart renders", () => {
    expect(parseDatabaseNames('{"core":"g1_erp_core_prod","sales":"g1_erp_sales_prod"}')).toEqual({
      core: "g1_erp_core_prod",
      sales: "g1_erp_sales_prod",
    });
  });

  it.each([
    ["no JSON", "core=g1_erp_core_prod", "setting_not_json"],
    ["a list", '["g1_erp_core_prod"]', "database_names_not_map"],
    ["an empty name", '{"core":""}', "database_names_not_map"],
    ["a name that is no string", '{"core":1}', "database_names_not_map"],
  ])("refuses %s", (_case, json, code) => {
    expect(() => parseDatabaseNames(json)).toThrow(expect.objectContaining({ code }));
  });
});

describe("grantedDatabaseName", () => {
  const names = { core: "g1_erp_core_prod", auth: "g1_erp_auth_prod" };

  it("returns the granted name of a suffix", () => {
    expect(grantedDatabaseName(names, "auth")).toBe("g1_erp_auth_prod");
  });

  it("names the missing suffix and what is granted", () => {
    expect(() => grantedDatabaseName(names, "sales")).toThrow(expect.objectContaining({ code: "database_not_granted", params: { suffix: "sales", granted: "core, auth" } }));
  });
});
