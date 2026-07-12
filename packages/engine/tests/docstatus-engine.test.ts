import { describe, it, expect, beforeEach } from "vitest";
import { DocStatus } from "@digitaplatform/shared";
import type { EntityDefinition } from "@digitaplatform/shared";
import { BaseDocument } from "../src/core/document/base-document.js";
import { DocStatusEngine, DocStatusError } from "../src/core/document/docstatus-engine.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeEntity(overrides: Partial<EntityDefinition> = {}): EntityDefinition {
  return {
    name: "Invoice",
    module: "billing",
    naming: { strategy: "auto_increment" },
    fields: [],
    permissions: [],
    is_submittable: true,
    ...overrides,
  } as EntityDefinition;
}

function makeDoc(docstatus: DocStatus, id = "INV-001"): BaseDocument {
  return new BaseDocument("Invoice", { _id: id, docstatus });
}

// ─── DocStatusError ────────────────────────────────────────────────────────

describe("DocStatusError", () => {
  it("is an instance of Error", () => {
    const err = new DocStatusError("not_submittable", { doctype: "Invoice" });
    expect(err).toBeInstanceOf(Error);
  });

  it("sets name to DocStatusError", () => {
    const err = new DocStatusError("not_submittable", { doctype: "Invoice" });
    expect(err.name).toBe("DocStatusError");
  });

  it("stores messageKey and params", () => {
    const err = new DocStatusError("already_submitted", { doctype: "Invoice", name: "INV-001" });
    expect(err.messageKey).toBe("already_submitted");
    expect(err.params).toEqual({ doctype: "Invoice", name: "INV-001" });
  });
});

// ─── validateSubmit ────────────────────────────────────────────────────────

describe("DocStatusEngine – validateSubmit", () => {
  const engine = new DocStatusEngine();

  it("passes when entity is submittable and doc is Draft", () => {
    const entity = makeEntity({ is_submittable: true });
    const doc = makeDoc(DocStatus.Draft);
    expect(() => engine.validateSubmit(entity, doc)).not.toThrow();
  });

  it("throws not_submittable when entity is not submittable", () => {
    const entity = makeEntity({ is_submittable: false });
    const doc = makeDoc(DocStatus.Draft);

    expect(() => engine.validateSubmit(entity, doc)).toThrow(DocStatusError);
    try {
      engine.validateSubmit(entity, doc);
    } catch (err) {
      expect((err as DocStatusError).messageKey).toBe("not_submittable");
      expect((err as DocStatusError).params["doctype"]).toBe("Invoice");
    }
  });

  it("throws already_submitted when doc is already Submitted", () => {
    const entity = makeEntity();
    const doc = makeDoc(DocStatus.Submitted);

    expect(() => engine.validateSubmit(entity, doc)).toThrow(DocStatusError);
    try {
      engine.validateSubmit(entity, doc);
    } catch (err) {
      expect((err as DocStatusError).messageKey).toBe("already_submitted");
      expect((err as DocStatusError).params["name"]).toBe("INV-001");
    }
  });

  it("throws cannot_submit_cancelled when doc is Cancelled", () => {
    const entity = makeEntity();
    const doc = makeDoc(DocStatus.Cancelled);

    expect(() => engine.validateSubmit(entity, doc)).toThrow(DocStatusError);
    try {
      engine.validateSubmit(entity, doc);
    } catch (err) {
      expect((err as DocStatusError).messageKey).toBe("cannot_submit_cancelled");
    }
  });
});

// ─── applySubmit ───────────────────────────────────────────────────────────

describe("DocStatusEngine – applySubmit", () => {
  const engine = new DocStatusEngine();

  it("sets doc.docstatus to Submitted (1)", () => {
    const doc = makeDoc(DocStatus.Draft);
    engine.applySubmit(doc);
    expect(doc.docstatus).toBe(DocStatus.Submitted);
  });

  it("also stores the new value via set() so the field is dirty", () => {
    const doc = makeDoc(DocStatus.Draft);
    engine.applySubmit(doc);
    expect(doc._dirty.has("docstatus")).toBe(true);
    expect(doc.get("docstatus")).toBe(DocStatus.Submitted);
  });
});

// ─── validateCancel ────────────────────────────────────────────────────────

describe("DocStatusEngine – validateCancel", () => {
  const engine = new DocStatusEngine();

  it("passes when entity is submittable and doc is Submitted", () => {
    const entity = makeEntity();
    const doc = makeDoc(DocStatus.Submitted);
    expect(() => engine.validateCancel(entity, doc)).not.toThrow();
  });

  it("throws not_submittable when entity is not submittable", () => {
    const entity = makeEntity({ is_submittable: false });
    const doc = makeDoc(DocStatus.Submitted);

    expect(() => engine.validateCancel(entity, doc)).toThrow(DocStatusError);
    try {
      engine.validateCancel(entity, doc);
    } catch (err) {
      expect((err as DocStatusError).messageKey).toBe("not_submittable");
    }
  });

  it("throws already_cancelled when doc is already Cancelled", () => {
    const entity = makeEntity();
    const doc = makeDoc(DocStatus.Cancelled);

    expect(() => engine.validateCancel(entity, doc)).toThrow(DocStatusError);
    try {
      engine.validateCancel(entity, doc);
    } catch (err) {
      expect((err as DocStatusError).messageKey).toBe("already_cancelled");
      expect((err as DocStatusError).params["name"]).toBe("INV-001");
    }
  });

  it("throws cannot_cancel_draft when doc is Draft", () => {
    const entity = makeEntity();
    const doc = makeDoc(DocStatus.Draft);

    expect(() => engine.validateCancel(entity, doc)).toThrow(DocStatusError);
    try {
      engine.validateCancel(entity, doc);
    } catch (err) {
      expect((err as DocStatusError).messageKey).toBe("cannot_cancel_draft");
    }
  });
});

// ─── applyCancel ───────────────────────────────────────────────────────────

describe("DocStatusEngine – applyCancel", () => {
  const engine = new DocStatusEngine();

  it("sets doc.docstatus to Cancelled (2)", () => {
    const doc = makeDoc(DocStatus.Submitted);
    engine.applyCancel(doc);
    expect(doc.docstatus).toBe(DocStatus.Cancelled);
  });

  it("also stores the new value via set() so the field is dirty", () => {
    const doc = makeDoc(DocStatus.Submitted);
    engine.applyCancel(doc);
    expect(doc._dirty.has("docstatus")).toBe(true);
    expect(doc.get("docstatus")).toBe(DocStatus.Cancelled);
  });
});

// ─── validateEdit ──────────────────────────────────────────────────────────

describe("DocStatusEngine – validateEdit", () => {
  const engine = new DocStatusEngine();

  it("passes for a Draft document on a submittable entity", () => {
    const entity = makeEntity();
    const doc = makeDoc(DocStatus.Draft);
    expect(() => engine.validateEdit(entity, doc)).not.toThrow();
  });

  it("passes for any document on a non-submittable entity", () => {
    const entity = makeEntity({ is_submittable: false });

    expect(() => engine.validateEdit(entity, makeDoc(DocStatus.Draft))).not.toThrow();
    expect(() => engine.validateEdit(entity, makeDoc(DocStatus.Submitted))).not.toThrow();
    expect(() => engine.validateEdit(entity, makeDoc(DocStatus.Cancelled))).not.toThrow();
  });

  it("throws cannot_edit_submitted when doc is Submitted", () => {
    const entity = makeEntity();
    const doc = makeDoc(DocStatus.Submitted);

    expect(() => engine.validateEdit(entity, doc)).toThrow(DocStatusError);
    try {
      engine.validateEdit(entity, doc);
    } catch (err) {
      expect((err as DocStatusError).messageKey).toBe("cannot_edit_submitted");
      expect((err as DocStatusError).params["doctype"]).toBe("Invoice");
    }
  });

  it("throws cannot_edit_cancelled when doc is Cancelled", () => {
    const entity = makeEntity();
    const doc = makeDoc(DocStatus.Cancelled);

    expect(() => engine.validateEdit(entity, doc)).toThrow(DocStatusError);
    try {
      engine.validateEdit(entity, doc);
    } catch (err) {
      expect((err as DocStatusError).messageKey).toBe("cannot_edit_cancelled");
    }
  });
});

// ─── validateDelete ────────────────────────────────────────────────────────

describe("DocStatusEngine – validateDelete", () => {
  const engine = new DocStatusEngine();

  it("passes for a Draft document on a submittable, non-log entity", () => {
    const entity = makeEntity({ is_submittable: true, is_log: false });
    const doc = makeDoc(DocStatus.Draft);
    expect(() => engine.validateDelete(entity, doc)).not.toThrow();
  });

  it("passes for a Cancelled document on a submittable entity", () => {
    const entity = makeEntity({ is_submittable: true, is_log: false });
    const doc = makeDoc(DocStatus.Cancelled);
    expect(() => engine.validateDelete(entity, doc)).not.toThrow();
  });

  it("throws cannot_delete_submitted when doc is Submitted", () => {
    const entity = makeEntity({ is_submittable: true, is_log: false });
    const doc = makeDoc(DocStatus.Submitted);

    expect(() => engine.validateDelete(entity, doc)).toThrow(DocStatusError);
    try {
      engine.validateDelete(entity, doc);
    } catch (err) {
      expect((err as DocStatusError).messageKey).toBe("cannot_delete_submitted");
      expect((err as DocStatusError).params["doctype"]).toBe("Invoice");
    }
  });

  it("throws cannot_delete_log for a log entity regardless of docstatus", () => {
    const entity = makeEntity({ is_submittable: false, is_log: true });

    for (const status of [DocStatus.Draft, DocStatus.Submitted, DocStatus.Cancelled]) {
      const doc = makeDoc(status);
      expect(() => engine.validateDelete(entity, doc)).toThrow(DocStatusError);
      try {
        engine.validateDelete(entity, doc);
      } catch (err) {
        expect((err as DocStatusError).messageKey).toBe("cannot_delete_log");
      }
    }
  });

  it("throws cannot_delete_submitted before checking is_log when both apply", () => {
    // is_submittable + is_log + Submitted → cannot_delete_submitted fires first
    const entity = makeEntity({ is_submittable: true, is_log: true });
    const doc = makeDoc(DocStatus.Submitted);

    expect(() => engine.validateDelete(entity, doc)).toThrow(DocStatusError);
    try {
      engine.validateDelete(entity, doc);
    } catch (err) {
      expect((err as DocStatusError).messageKey).toBe("cannot_delete_submitted");
    }
  });
});

// ─── prepareAmend ──────────────────────────────────────────────────────────

describe("DocStatusEngine – prepareAmend", () => {
  const engine = new DocStatusEngine();

  it("returns amended_from with the original doc _id for a Cancelled doc", () => {
    const entity = makeEntity();
    const doc = makeDoc(DocStatus.Cancelled, "INV-001");

    const result = engine.prepareAmend(entity, doc);

    expect(result).toEqual({ amended_from: "INV-001" });
  });

  it("throws cannot_amend_not_cancelled when doc is Draft", () => {
    const entity = makeEntity();
    const doc = makeDoc(DocStatus.Draft);

    expect(() => engine.prepareAmend(entity, doc)).toThrow(DocStatusError);
    try {
      engine.prepareAmend(entity, doc);
    } catch (err) {
      expect((err as DocStatusError).messageKey).toBe("cannot_amend_not_cancelled");
      expect((err as DocStatusError).params["doctype"]).toBe("Invoice");
      expect((err as DocStatusError).params["name"]).toBe("INV-001");
    }
  });

  it("throws cannot_amend_not_cancelled when doc is Submitted", () => {
    const entity = makeEntity();
    const doc = makeDoc(DocStatus.Submitted, "INV-002");

    expect(() => engine.prepareAmend(entity, doc)).toThrow(DocStatusError);
    try {
      engine.prepareAmend(entity, doc);
    } catch (err) {
      expect((err as DocStatusError).messageKey).toBe("cannot_amend_not_cancelled");
      expect((err as DocStatusError).params["name"]).toBe("INV-002");
    }
  });
});

// ─── validateSubmittedPatch (the post-submit band gate) ─────────────────────

describe("DocStatusEngine – validateSubmittedPatch", () => {
  const engine = new DocStatusEngine();

  function field(
    fieldname: string,
    fieldtype: string,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return { fieldname, fieldtype, label: fieldname, ...extra };
  }

  function entityWith(
    fields: Record<string, unknown>[],
    overrides: Partial<EntityDefinition> = {},
  ): EntityDefinition {
    return makeEntity({ is_submittable: true, fields: fields as never, ...overrides });
  }

  function submitted(id = "INV-001"): BaseDocument {
    return new BaseDocument("Invoice", { _id: id, docstatus: DocStatus.Submitted });
  }

  function touched(
    p: {
      set?: string[];
      inc?: string[];
      children?: Array<{ table: string; setFields?: string[]; incrementFields?: string[] }>;
    } = {},
  ) {
    return {
      setFields: p.set ?? [],
      incrementFields: p.inc ?? [],
      children: p.children?.map((c) => ({
        table: c.table,
        setFields: c.setFields ?? [],
        incrementFields: c.incrementFields ?? [],
      })),
    };
  }

  function keyOf(fn: () => void): string | undefined {
    try {
      fn();
      return undefined;
    } catch (err) {
      return (err as DocStatusError).messageKey;
    }
  }

  const bandEntity = entityWith([
    field("amount_paid", "Currency", { allow_on_submit: true }),
    field("status", "Select", { allow_on_submit: true }),
    field("grand_total", "Currency"), // NOT flagged — frozen
    field("note", "Data", { allow_on_submit: true }),
  ]);

  // ── docstatus / submittability gates ──

  it("throws not_submittable when the entity is not submittable", () => {
    const e = entityWith([field("amount_paid", "Currency", { allow_on_submit: true })], {
      is_submittable: false,
    });
    expect(keyOf(() => engine.validateSubmittedPatch(e, submitted(), touched({ set: ["amount_paid"] })))).toBe(
      "not_submittable",
    );
  });

  it("throws not_submitted for a Draft (docstatus 0)", () => {
    const doc = new BaseDocument("Invoice", { _id: "X", docstatus: DocStatus.Draft });
    expect(keyOf(() => engine.validateSubmittedPatch(bandEntity, doc, touched({ set: ["amount_paid"] })))).toBe(
      "not_submitted",
    );
  });

  it("throws not_submitted for a Cancelled doc (docstatus 2 stays frozen)", () => {
    const doc = new BaseDocument("Invoice", { _id: "X", docstatus: DocStatus.Cancelled });
    expect(keyOf(() => engine.validateSubmittedPatch(bandEntity, doc, touched({ set: ["amount_paid"] })))).toBe(
      "not_submitted",
    );
  });

  // ── band membership ──

  it("passes a set on an allow_on_submit field", () => {
    expect(() =>
      engine.validateSubmittedPatch(bandEntity, submitted(), touched({ set: ["amount_paid"] })),
    ).not.toThrow();
  });

  it("rejects a set on an unflagged (frozen) field", () => {
    expect(
      keyOf(() => engine.validateSubmittedPatch(bandEntity, submitted(), touched({ set: ["grand_total"] }))),
    ).toBe("field_not_allowed_on_submit");
  });

  it("rejects an undeclared field (no pass-through post-submit)", () => {
    expect(
      keyOf(() => engine.validateSubmittedPatch(bandEntity, submitted(), touched({ set: ["nonesuch"] }))),
    ).toBe("field_not_allowed_on_submit");
  });

  // ── system fields ──

  it("rejects every system/identity field regardless of flags", () => {
    for (const sys of [
      "docstatus",
      "owner",
      "creation",
      "modified",
      "modified_by",
      "_id",
      "amended_from",
      "doctype",
      "idx",
    ]) {
      expect(keyOf(() => engine.validateSubmittedPatch(bandEntity, submitted(), touched({ set: [sys] })))).toBe(
        "field_not_allowed_on_submit",
      );
    }
  });

  it("rejects any _-prefixed key", () => {
    expect(
      keyOf(() => engine.validateSubmittedPatch(bandEntity, submitted(), touched({ set: ["_row_id"] }))),
    ).toBe("field_not_allowed_on_submit");
  });

  // ── workflow field admission ──

  it("admits the workflow field when opts.allowWorkflowField, even if unflagged", () => {
    const e = entityWith([field("state", "Select")], { workflow_field: "state" });
    expect(() =>
      engine.validateSubmittedPatch(e, submitted(), touched({ set: ["state"] }), {
        allowWorkflowField: true,
      }),
    ).not.toThrow();
  });

  it("rejects the workflow field without allowWorkflowField when it is unflagged", () => {
    const e = entityWith([field("state", "Select")], { workflow_field: "state" });
    expect(keyOf(() => engine.validateSubmittedPatch(e, submitted(), touched({ set: ["state"] })))).toBe(
      "field_not_allowed_on_submit",
    );
  });

  it("admits a band-flagged workflow field via the band even without allowWorkflowField (hook path)", () => {
    // status is allow_on_submit in bandEntity → settlement hooks may set it directly.
    expect(() =>
      engine.validateSubmittedPatch(bandEntity, submitted(), touched({ set: ["status"] })),
    ).not.toThrow();
  });

  // ── increment ──

  it("passes an increment on a numeric flagged field", () => {
    expect(() =>
      engine.validateSubmittedPatch(bandEntity, submitted(), touched({ inc: ["amount_paid"] })),
    ).not.toThrow();
  });

  it("rejects an increment on a non-numeric flagged field", () => {
    expect(keyOf(() => engine.validateSubmittedPatch(bandEntity, submitted(), touched({ inc: ["note"] })))).toBe(
      "increment_not_numeric",
    );
  });

  // ── overlap / empty ──

  it("rejects a field that is both set and incremented", () => {
    expect(
      keyOf(() =>
        engine.validateSubmittedPatch(bandEntity, submitted(), touched({ set: ["amount_paid"], inc: ["amount_paid"] })),
      ),
    ).toBe("set_increment_overlap");
  });

  it("rejects an empty patch", () => {
    expect(keyOf(() => engine.validateSubmittedPatch(bandEntity, submitted(), touched({})))).toBe(
      "empty_submitted_patch",
    );
  });

  // ── children ──

  const childEntity = entityWith([
    field("lines", "Table", {
      child_fields: [
        field("delivered_quantity", "Float", { allow_on_submit: true }),
        field("quantity", "Float"), // frozen cell
      ],
    }),
    field("notes", "Table", {
      allow_on_submit: true, // whole-row edit surface
      child_fields: [field("text", "Data"), field("seq", "Int")],
    }),
  ]);

  it("passes a patch on a flagged child cell", () => {
    expect(() =>
      engine.validateSubmittedPatch(
        childEntity,
        submitted(),
        touched({ children: [{ table: "lines", incrementFields: ["delivered_quantity"] }] }),
      ),
    ).not.toThrow();
  });

  it("rejects a patch on an unflagged child cell", () => {
    expect(
      keyOf(() =>
        engine.validateSubmittedPatch(
          childEntity,
          submitted(),
          touched({ children: [{ table: "lines", setFields: ["quantity"] }] }),
        ),
      ),
    ).toBe("field_not_allowed_on_submit");
  });

  it("admits any declared cell when the Table field itself is flagged", () => {
    expect(() =>
      engine.validateSubmittedPatch(
        childEntity,
        submitted(),
        touched({ children: [{ table: "notes", setFields: ["text"], incrementFields: ["seq"] }] }),
      ),
    ).not.toThrow();
  });

  it("rejects _row_id / idx as child cell keys", () => {
    for (const cell of ["_row_id", "idx"]) {
      expect(
        keyOf(() =>
          engine.validateSubmittedPatch(
            childEntity,
            submitted(),
            touched({ children: [{ table: "notes", setFields: [cell] }] }),
          ),
        ),
      ).toBe("field_not_allowed_on_submit");
    }
  });

  it("rejects an undeclared child table", () => {
    expect(
      keyOf(() =>
        engine.validateSubmittedPatch(
          childEntity,
          submitted(),
          touched({ children: [{ table: "ghost", setFields: ["x"] }] }),
        ),
      ),
    ).toBe("field_not_allowed_on_submit");
  });

  it("rejects an undeclared child cell", () => {
    expect(
      keyOf(() =>
        engine.validateSubmittedPatch(
          childEntity,
          submitted(),
          touched({ children: [{ table: "lines", setFields: ["ghost"] }] }),
        ),
      ),
    ).toBe("field_not_allowed_on_submit");
  });

  it("rejects an increment on a non-numeric child cell", () => {
    expect(
      keyOf(() =>
        engine.validateSubmittedPatch(
          childEntity,
          submitted(),
          touched({ children: [{ table: "notes", incrementFields: ["text"] }] }),
        ),
      ),
    ).toBe("increment_not_numeric");
  });

  // ── security / structural-invariant regressions (Fable-5 review) ──

  it("rejects a Table field in a top-level set even when the Table is flagged (tables only via children[])", () => {
    // A flagged Table's whole-array replacement would add/remove rows (structural
    // change of the frozen core) and drop _row_ids — must be rejected.
    expect(
      keyOf(() => engine.validateSubmittedPatch(childEntity, submitted(), touched({ set: ["notes"] }))),
    ).toBe("field_not_allowed_on_submit");
  });

  it("rejects the workflow field via allowWorkflowField when it is NOT a declared field", () => {
    // The E5 hole: transition() with allowWorkflowField on a workflow-less
    // submittable entity must not let an arbitrary undeclared key be written.
    const e = entityWith([field("amount_paid", "Currency", { allow_on_submit: true })], {
      workflow_field: "status", // 'status' is NOT among the declared fields
    });
    expect(
      keyOf(() =>
        engine.validateSubmittedPatch(e, submitted(), touched({ set: ["status"] }), {
          allowWorkflowField: true,
        }),
      ),
    ).toBe("field_not_allowed_on_submit");
  });
});

// ─── Full state-machine transitions ────────────────────────────────────────

describe("DocStatusEngine – full state machine", () => {
  const engine = new DocStatusEngine();

  it("Draft → Submit → Cancel → Amend is the happy path", () => {
    const entity = makeEntity();
    const doc = makeDoc(DocStatus.Draft, "INV-001");

    // Submit
    expect(() => engine.validateSubmit(entity, doc)).not.toThrow();
    engine.applySubmit(doc);
    expect(doc.docstatus).toBe(DocStatus.Submitted);

    // Cancel
    expect(() => engine.validateCancel(entity, doc)).not.toThrow();
    engine.applyCancel(doc);
    expect(doc.docstatus).toBe(DocStatus.Cancelled);

    // Amend
    const amendData = engine.prepareAmend(entity, doc);
    expect(amendData["amended_from"]).toBe("INV-001");
  });

  it("Cannot go from Cancelled back to Submitted", () => {
    const entity = makeEntity();
    const doc = makeDoc(DocStatus.Cancelled);

    expect(() => engine.validateSubmit(entity, doc)).toThrow(DocStatusError);
  });

  it("Cannot edit a Submitted document", () => {
    const entity = makeEntity();
    const doc = makeDoc(DocStatus.Submitted);
    engine.applySubmit(doc); // ensure state is consistent

    expect(() => engine.validateEdit(entity, doc)).toThrow(DocStatusError);
  });

  it("Can edit a Draft document after cancellation and amendment creates a new draft", () => {
    const entity = makeEntity();

    // Original doc: cancelled
    const original = makeDoc(DocStatus.Cancelled, "INV-001");
    const amendData = engine.prepareAmend(entity, original);

    // Create new draft from amend data
    const newDoc = new BaseDocument("Invoice", {
      _id: "INV-001-A",
      docstatus: DocStatus.Draft,
      ...amendData,
    });

    expect(() => engine.validateEdit(entity, newDoc)).not.toThrow();
    expect(newDoc.get("amended_from")).toBe("INV-001");
  });
});
