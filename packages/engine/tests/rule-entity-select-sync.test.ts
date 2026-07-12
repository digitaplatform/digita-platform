// Keeps Rule.entity.json's Select options in lockstep with the code that
// dispatches events / executes actions — a drift here means the admin UI would
// offer an event that never fires or an action the engine no longer runs.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { DISPATCHED_RULE_EVENTS } from "../src/core/rules/rule-types.js";

const VALID_ACTION_TYPES = ["create_document", "update_document", "validate", "set_value"];

const entity = JSON.parse(
  readFileSync(fileURLToPath(new URL("../src/entities/Rule.entity.json", import.meta.url)), "utf-8"),
) as {
  fields: Array<{
    fieldname: string;
    options?: string[];
    child_fields?: Array<{ fieldname: string; options?: string[] }>;
  }>;
};

describe("Rule.entity.json Select ⇔ code", () => {
  it("event options equal DISPATCHED_RULE_EVENTS", () => {
    const eventField = entity.fields.find((f) => f.fieldname === "event")!;
    expect(new Set(eventField.options)).toEqual(DISPATCHED_RULE_EVENTS);
  });

  it("action type options equal the executable action types", () => {
    const actions = entity.fields.find((f) => f.fieldname === "actions")!;
    const typeField = actions.child_fields!.find((f) => f.fieldname === "type")!;
    expect(new Set(typeField.options)).toEqual(new Set(VALID_ACTION_TYPES));
  });
});
