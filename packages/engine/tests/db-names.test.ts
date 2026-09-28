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
    ["no JSON", "core=g1_erp_core_prod", /not valid JSON/],
    ["a list", '["g1_erp_core_prod"]', /must map each suffix/],
    ["an empty name", '{"core":""}', /must map each suffix/],
    ["a name that is no string", '{"core":1}', /must map each suffix/],
  ])("refuses %s", (_case, json, message) => {
    expect(() => parseDatabaseNames(json)).toThrow(message);
  });
});

describe("grantedDatabaseName", () => {
  const names = { core: "g1_erp_core_prod", auth: "g1_erp_auth_prod" };

  it("returns the granted name of a suffix", () => {
    expect(grantedDatabaseName(names, "auth")).toBe("g1_erp_auth_prod");
  });

  it("names the missing suffix and what is granted", () => {
    expect(() => grantedDatabaseName(names, "sales")).toThrow('no database for "sales"; it grants: core, auth');
  });
});
