import { describe, it, expect } from "vitest";
import type { EntityDefinition } from "@digitaplatform/shared";
import { resolveStatusIndicator } from "../src/core/status/status-resolver.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntity(overrides: Partial<EntityDefinition> = {}): EntityDefinition {
  return {
    name: "TestDoc",
    module: "test",
    database: "app",
    naming: { strategy: "user_set" },
    fields: [],
    permissions: [],
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("resolveStatusIndicator", () => {
  // ── No states defined ────────────────────────────────────────────────────

  it("returns undefined when entity has no states property", () => {
    const entity = makeEntity(); // states not set
    expect(resolveStatusIndicator(entity, { status: "Active" })).toBeUndefined();
  });

  it("returns undefined when entity.states is an empty array", () => {
    const entity = makeEntity({ states: [] });
    expect(resolveStatusIndicator(entity, { status: "Active" })).toBeUndefined();
  });

  // ── Default status field ──────────────────────────────────────────────────

  it("uses 'status' field by default when timeline_field is not set", () => {
    const entity = makeEntity({
      states: [
        { value: "Active", color: "green" },
        { value: "Inactive", color: "red" },
      ],
    });
    expect(resolveStatusIndicator(entity, { status: "Active" })).toEqual({ color: "green" });
  });

  it("falls back to workflow_field when timeline_field is not set", () => {
    const entity = makeEntity({
      workflow_field: "approval_state",
      states: [{ value: "Submitted", color: "blue" }],
    } as Partial<EntityDefinition>);
    // Data carries the workflow field, not 'status'.
    expect(resolveStatusIndicator(entity, { approval_state: "Submitted" })).toEqual({ color: "blue" });
  });

  it("timeline_field still wins over workflow_field when both are set", () => {
    const entity = makeEntity({
      timeline_field: "tf",
      workflow_field: "wf",
      states: [
        { value: "A", color: "green" },
        { value: "B", color: "red" },
      ],
    } as Partial<EntityDefinition>);
    expect(resolveStatusIndicator(entity, { tf: "A", wf: "B" })).toEqual({ color: "green" });
  });

  it("returns matching state color for 'Inactive' status", () => {
    const entity = makeEntity({
      states: [
        { value: "Active", color: "green" },
        { value: "Inactive", color: "red" },
      ],
    });
    expect(resolveStatusIndicator(entity, { status: "Inactive" })).toEqual({ color: "red" });
  });

  // ── No matching value ─────────────────────────────────────────────────────

  it("returns undefined when status value does not match any state", () => {
    const entity = makeEntity({
      states: [
        { value: "Active", color: "green" },
        { value: "Inactive", color: "red" },
      ],
    });
    expect(resolveStatusIndicator(entity, { status: "Pending" })).toBeUndefined();
  });

  it("returns undefined when status value is an empty string", () => {
    const entity = makeEntity({
      states: [{ value: "Active", color: "green" }],
    });
    expect(resolveStatusIndicator(entity, { status: "" })).toBeUndefined();
  });

  // ── Missing status value in data ──────────────────────────────────────────

  it("returns undefined when data has no status field", () => {
    const entity = makeEntity({
      states: [{ value: "Active", color: "green" }],
    });
    expect(resolveStatusIndicator(entity, {})).toBeUndefined();
  });

  it("returns undefined when status field value is undefined", () => {
    const entity = makeEntity({
      states: [{ value: "Active", color: "green" }],
    });
    expect(resolveStatusIndicator(entity, { status: undefined })).toBeUndefined();
  });

  it("returns undefined when status field value is null", () => {
    const entity = makeEntity({
      states: [{ value: "Active", color: "green" }],
    });
    expect(resolveStatusIndicator(entity, { status: null })).toBeUndefined();
  });

  // ── Custom timeline_field ─────────────────────────────────────────────────

  it("uses custom timeline_field instead of 'status'", () => {
    const entity = makeEntity({
      timeline_field: "workflow_state",
      states: [
        { value: "Draft", color: "gray" },
        { value: "Submitted", color: "blue" },
      ],
    });
    expect(resolveStatusIndicator(entity, { workflow_state: "Submitted" })).toEqual({ color: "blue" });
  });

  it("does not read from 'status' when timeline_field is set to another field", () => {
    const entity = makeEntity({
      timeline_field: "workflow_state",
      states: [{ value: "Draft", color: "gray" }],
    });
    // 'status' has a matching value but the entity uses workflow_state
    const result = resolveStatusIndicator(entity, { status: "Draft", workflow_state: "Unknown" });
    expect(result).toBeUndefined();
  });

  it("returns undefined when custom timeline_field is missing from data", () => {
    const entity = makeEntity({
      timeline_field: "phase",
      states: [{ value: "Planning", color: "orange" }],
    });
    expect(resolveStatusIndicator(entity, { status: "Planning" })).toBeUndefined();
  });

  // ── Only color is returned ────────────────────────────────────────────────

  it("returns only { color } — does not include the full StateDefinition", () => {
    const entity = makeEntity({
      states: [{ value: "Active", color: "green", indicator: "dot" }],
    });
    const result = resolveStatusIndicator(entity, { status: "Active" });
    expect(result).toEqual({ color: "green" });
    expect(result).not.toHaveProperty("value");
    expect(result).not.toHaveProperty("indicator");
  });

  // ── Multiple states — correct match ───────────────────────────────────────

  it("returns the color of the first matching state when values are unique", () => {
    const entity = makeEntity({
      states: [
        { value: "Open", color: "blue" },
        { value: "In Progress", color: "yellow" },
        { value: "Closed", color: "gray" },
      ],
    });
    expect(resolveStatusIndicator(entity, { status: "In Progress" })).toEqual({ color: "yellow" });
    expect(resolveStatusIndicator(entity, { status: "Closed" })).toEqual({ color: "gray" });
  });
});
