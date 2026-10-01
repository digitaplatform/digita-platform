import { describe, it, expect, vi } from "vitest";

vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import type { EntityDefinition } from "@digitaplatform/shared";
import { SYSTEM_ROLES } from "@digitaplatform/shared";
import { PermissionChecker } from "../src/core/permissions/permission-checker.js";
import { RealtimeService } from "../src/core/realtime/realtime-service.js";
import type { EntityRegistry } from "../src/core/entity/entity-registry.js";
import type { UserContext } from "../src/core/permissions/types.js";

const NOTE: EntityDefinition = {
  name: "Note",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  fields: [
    { fieldname: "title", fieldtype: "Data", label: "Title" },
    { fieldname: "status", fieldtype: "Data", label: "Status" },
  ],
  permissions: [
    { role: "Reader", level: 0, select: 1, read: 1 },
    { role: "Author", level: 0, select: 1, read: 1, if_owner: 1 },
    { role: "Public", level: 0, select: 1, read: 1, condition: "doc.status == 'published'" },
    { role: "Branch", level: 0, select: 1, read: 1, scope: { field: "branch", user_field: "branch" } },
  ],
} as unknown as EntityDefinition;

// Rows of this entity name the roles that may see them, as Workspace does.
const BOARD: EntityDefinition = {
  name: "Board",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  role_visibility_field: "roles",
  fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
  permissions: [{ role: "Reader", level: 0, select: 1, read: 1 }],
} as unknown as EntityDefinition;

// A workflow state that takes read away from a role makes that role's access depend on the row.
const TICKET: EntityDefinition = {
  name: "Ticket",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  fields: [{ fieldname: "status", fieldtype: "Data", label: "Status" }],
  states: [
    { value: "open", label: "Open", is_initial: true },
    { value: "sealed", label: "Sealed", permissions: [{ role: "Reader", read: 0 }] },
  ],
  transitions: [{ from: "open", to: "sealed", allowed_roles: ["Reader"] }],
  permissions: [{ role: "Reader", level: 0, select: 1, read: 1 }],
} as unknown as EntityDefinition;

const entities = new Map([NOTE, BOARD, TICKET].map((e) => [e.name, e]));
const registry = { get: (name: string) => entities.get(name)! } as unknown as EntityRegistry;

function user(...roles: string[]): UserContext {
  return { _id: `u-${roles.join("-")}`, email: `${roles.join("-")}@example.com`, roles };
}

/** Subscribe `who` to `entity`, broadcast one change, and return what its socket received. */
async function received(who: UserContext, entity: string): Promise<Record<string, unknown>[]> {
  const service = new RealtimeService(new PermissionChecker(registry));
  const sent: string[] = [];
  const client = service.add({ readyState: 1, send: (data) => sent.push(data) }, who);
  service.subscribe(client, [entity]);
  service.broadcast({ entity, name: "ROW-1", op: "update" });
  // The fan-out runs after broadcast returns; its permission checks settle within one turn.
  await new Promise((resolve) => setImmediate(resolve));
  return sent.map((data) => JSON.parse(data) as Record<string, unknown>);
}

describe("realtime change events", () => {
  it("name the row and the operation for a subscriber who may read every row", async () => {
    expect(await received(user("Reader"), "Note")).toEqual([
      { type: "change", entity: "Note", name: "ROW-1", op: "update" },
    ]);
  });

  it("name the row for an Administrator", async () => {
    expect(await received(user(SYSTEM_ROLES.ADMINISTRATOR), "Board")).toEqual([
      { type: "change", entity: "Board", name: "ROW-1", op: "update" },
    ]);
  });

  it.each([
    ["an owner rule", "Note", "Author"],
    ["a condition", "Note", "Public"],
    ["a scope", "Note", "Branch"],
    ["role visibility", "Board", "Reader"],
    ["a state that takes read away", "Ticket", "Reader"],
  ])("carry no row and no operation when %s may hide the row", async (_case, entity, role) => {
    expect(await received(user(role), entity)).toEqual([{ type: "change", entity }]);
  });

  it("reach no subscriber who may not list the entity", async () => {
    expect(await received(user("Stranger"), "Note")).toEqual([]);
  });
});
