// F6: update_document is a GOVERNED post-submit band patch — it routes through
// DocumentService.updateSubmitted (never a raw db.updateOne), forwarding the
// patch shape, cause provenance and the caller's session.
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

function throwingDb() {
  return {
    updateOne: vi.fn(() => {
      throw new Error("raw db.updateOne must never be used by update_document");
    }),
    insertOne: vi.fn(() => {
      throw new Error("raw db.insertOne must never be used by update_document");
    }),
  };
}

describe("update_document — governed via updateSubmitted", () => {
  beforeEach(() => loadActiveRulesMock.mockReset());

  it("(a) forwards patch shape, cause and sessionOverride; no raw db write", async () => {
    loadActiveRulesMock.mockResolvedValue([
      {
        _id: "r",
        label: "r",
        entity: "Order",
        event: "on_submit",
        actions: [
          {
            type: "update_document",
            target_entity: "Invoice",
            target_name: "'INV-1'",
            field_mappings: { status: "'paid'" },
          },
        ],
      },
    ]);
    const db = throwingDb();
    const engine = new RuleEngine(db as never, registry);
    const updateSubmitted = vi.fn().mockResolvedValue({});
    engine.setDocumentService({ insert: vi.fn(), updateSubmitted } as never);
    const session = { id: "sess" } as never;

    await engine.execute("Order", "on_submit", { _id: "ORD-9" }, user, session);

    expect(updateSubmitted).toHaveBeenCalledTimes(1);
    expect(updateSubmitted).toHaveBeenCalledWith(
      "Invoice",
      "INV-1",
      { set: { status: "paid" } },
      user,
      undefined,
      { sessionOverride: session, cause: { doctype: "Order", name: "ORD-9" } },
    );
    expect(db.updateOne).not.toHaveBeenCalled();
  });

  it("(b) iterate emits one governed call per matching row", async () => {
    loadActiveRulesMock.mockResolvedValue([
      {
        _id: "r",
        label: "r",
        entity: "Order",
        event: "on_submit",
        actions: [
          {
            type: "update_document",
            target_entity: "Invoice",
            iterate: "doc.lines",
            condition: "row.post",
            target_name: "row.inv",
            field_mappings: { status: "'x'" },
          },
        ],
      },
    ]);
    const engine = new RuleEngine(throwingDb() as never, registry);
    const updateSubmitted = vi.fn().mockResolvedValue({});
    engine.setDocumentService({ insert: vi.fn(), updateSubmitted } as never);

    await engine.execute(
      "Order",
      "on_submit",
      { _id: "O1", lines: [{ inv: "A", post: true }, { inv: "B", post: false }, { inv: "C", post: true }] },
      user,
      {} as never,
    );

    // Only the two rows whose per-row condition holds emit a call.
    expect(updateSubmitted).toHaveBeenCalledTimes(2);
    expect(updateSubmitted.mock.calls.map((c) => c[1])).toEqual(["A", "C"]);
  });

  it("(c) throws fail-loud when DocumentService is not wired", async () => {
    loadActiveRulesMock.mockResolvedValue([
      {
        _id: "r",
        label: "r",
        entity: "Order",
        event: "on_submit",
        actions: [
          {
            type: "update_document",
            target_entity: "Invoice",
            target_name: "'INV-1'",
            field_mappings: { status: "'paid'" },
          },
        ],
      },
    ]);
    const engine = new RuleEngine(throwingDb() as never, registry);
    await expect(
      engine.execute("Order", "on_submit", { _id: "ORD-9" }, user, {} as never),
    ).rejects.toThrow(/DocumentService not wired/);
  });
});
