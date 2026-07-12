// P3: create_document has no ungoverned fallback — it routes through
// DocumentService.insert, and fails loud when the service is not wired.
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

const loadActiveRulesMock = vi.fn();
vi.mock("../src/core/rules/rule-loader.js", () => ({
  loadActiveRules: (...args: unknown[]) => loadActiveRulesMock(...args),
}));

import { RuleEngine } from "../src/core/rules/rule-engine.js";

const user = { _id: "u", email: "u@x", roles: [] } as never;
const registry = { get: () => ({ database: "app" }) } as never;
const throwingDb = {
  insertOne: vi.fn(() => {
    throw new Error("raw db.insertOne must never be used by create_document");
  }),
} as never;

const rule = {
  _id: "r",
  label: "r",
  entity: "Stocktake",
  event: "on_submit",
  actions: [
    { type: "create_document", target_entity: "StockMovement", field_mappings: { qty: "1" } },
  ],
};

describe("create_document — governed insert only", () => {
  beforeEach(() => loadActiveRulesMock.mockResolvedValue([rule]));

  it("throws fail-loud when DocumentService is not wired", async () => {
    const engine = new RuleEngine(throwingDb, registry);
    await expect(
      engine.execute("Stocktake", "on_submit", { _id: "ST-1" }, user, {} as never),
    ).rejects.toThrow(/DocumentService not wired/);
  });

  it("routes through DocumentService.insert when wired", async () => {
    const engine = new RuleEngine(throwingDb, registry);
    const insert = vi.fn().mockResolvedValue({});
    engine.setDocumentService({ insert, updateSubmitted: vi.fn() } as never);
    const session = { id: "s" } as never;
    await engine.execute("Stocktake", "on_submit", { _id: "ST-1" }, user, session);
    expect(insert).toHaveBeenCalledWith("StockMovement", { qty: 1 }, user, undefined, session);
  });
});
