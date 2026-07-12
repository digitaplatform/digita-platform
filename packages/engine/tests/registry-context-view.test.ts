// The context contract fields (context_view on Link, entry_context_view/
// entry_context_params on Table) must survive the registry round-trip
// untouched — the UI renders context panels purely from this metadata.
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "mongodb://localhost:27017",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "u", MONGODB_LOGS_DB: "l", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "a",
    MONGODB_APP_DB_PREFIX: "test",
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { EntityRegistry } from "../src/core/entity/entity-registry.js";
import type { EntityDefinition } from "@digitaplatform/shared";

describe("context contract fields pass through the registry", () => {
  it("keeps context_view on Link and entry_context_view/params on Table", () => {
    const registry = new EntityRegistry();
    registry.register({
      name: "CtxDoc",
      module: "test",
      database: "app",
      naming: { strategy: "user_set" },
      fields: [
        {
          fieldname: "customer",
          fieldtype: "Link",
          label: "Customer",
          target: "Customer",
          context_view: "customer360",
          context_title: "ui.context.customer",
        },
        {
          fieldname: "lines",
          fieldtype: "Table",
          label: "Lines",
          entry_flow: { sequence: ["qty"] },
          entry_context_view: "lineContext",
          entry_context_params: { product: "product", customer: "$doc.customer" },
          child_fields: [
            { fieldname: "product", fieldtype: "Link", label: "Product", target: "Product" },
            { fieldname: "qty", fieldtype: "Float", label: "Qty" },
          ],
        },
      ],
      permissions: [],
    } as unknown as EntityDefinition);

    const entity = registry.get("CtxDoc");
    const customer = entity.fields.find((f) => f.fieldname === "customer")!;
    expect(customer.context_view).toBe("customer360");
    expect(customer.context_title).toBe("ui.context.customer");
    const lines = entity.fields.find((f) => f.fieldname === "lines")!;
    expect(lines.entry_context_view).toBe("lineContext");
    expect(lines.entry_context_params).toEqual({ product: "product", customer: "$doc.customer" });
  });
});
