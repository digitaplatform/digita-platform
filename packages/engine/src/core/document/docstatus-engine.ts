import { DocStatus, NUMERIC_FIELD_TYPES } from "@digitaplatform/shared";
import type { EntityDefinition, FieldDefinition } from "@digitaplatform/shared";
import type { BaseDocument } from "./base-document.js";

export class DocStatusError extends Error {
  constructor(
    public messageKey: string,
    public params: Record<string, string>,
  ) {
    super(`DocStatus error: ${messageKey}`);
    this.name = "DocStatusError";
  }
}

/**
 * Fields that may NEVER appear in a SubmittedPatch, regardless of any
 * `allow_on_submit` flag — service-stamped or identity/lifecycle fields.
 * (`modified` / `modified_by` are stamped by updateSubmitted itself; any
 * `_`-prefixed key is rejected too — see validateSubmittedPatch.)
 */
const SUBMITTED_PATCH_SYSTEM_FIELDS = new Set([
  "docstatus",
  "owner",
  "creation",
  "modified",
  "modified_by",
  "_id",
  "amended_from",
  "doctype",
  "idx",
]);

const NUMERIC_TYPES = new Set<string>(NUMERIC_FIELD_TYPES);

/** Shape of the fields a caller intends to touch in a post-submit patch. */
export interface SubmittedPatchTouched {
  /** Top-level fields assigned via `set`. */
  setFields: string[];
  /** Top-level fields adjusted via `increment` (must be numeric). */
  incrementFields: string[];
  /** Per-table child-cell touches. */
  children?: Array<{ table: string; setFields: string[]; incrementFields: string[] }>;
}

/**
 * Validate and execute document status transitions.
 */
export class DocStatusEngine {
  /**
   * Submit: Draft (0) → Submitted (1)
   */
  validateSubmit(entity: EntityDefinition, doc: BaseDocument): void {
    if (!entity.is_submittable) {
      throw new DocStatusError("not_submittable", { doctype: entity.name });
    }

    if (doc.docstatus !== DocStatus.Draft) {
      if (doc.docstatus === DocStatus.Submitted) {
        throw new DocStatusError("already_submitted", {
          doctype: entity.name,
          name: doc._id,
        });
      }
      throw new DocStatusError("cannot_submit_cancelled", {
        doctype: entity.name,
        name: doc._id,
      });
    }
  }

  applySubmit(doc: BaseDocument): void {
    doc.docstatus = DocStatus.Submitted;
    doc.set("docstatus", DocStatus.Submitted);
  }

  /**
   * Cancel: Submitted (1) → Cancelled (2)
   */
  validateCancel(entity: EntityDefinition, doc: BaseDocument): void {
    if (!entity.is_submittable) {
      throw new DocStatusError("not_submittable", { doctype: entity.name });
    }

    if (doc.docstatus !== DocStatus.Submitted) {
      if (doc.docstatus === DocStatus.Cancelled) {
        throw new DocStatusError("already_cancelled", {
          doctype: entity.name,
          name: doc._id,
        });
      }
      throw new DocStatusError("cannot_cancel_draft", {
        doctype: entity.name,
        name: doc._id,
      });
    }
  }

  applyCancel(doc: BaseDocument): void {
    doc.docstatus = DocStatus.Cancelled;
    doc.set("docstatus", DocStatus.Cancelled);
  }

  /**
   * Check if a document can be edited (not submitted).
   */
  validateEdit(entity: EntityDefinition, doc: BaseDocument): void {
    if (entity.is_submittable && doc.docstatus === DocStatus.Submitted) {
      throw new DocStatusError("cannot_edit_submitted", {
        doctype: entity.name,
      });
    }

    if (entity.is_submittable && doc.docstatus === DocStatus.Cancelled) {
      throw new DocStatusError("cannot_edit_cancelled", {
        doctype: entity.name,
      });
    }
  }

  /**
   * The band gate for `DocumentService.updateSubmitted`. Throws when a
   * post-submit patch touches anything outside the sanctioned band:
   *   - only submittable entities in docstatus=1 may be patched (drafts use
   *     `update()`; cancelled docs stay fully frozen);
   *   - system/identity fields and any `_`-prefixed key are always rejected;
   *   - each top-level field must carry `allow_on_submit: true` (the workflow
   *     field also passes when `opts.allowWorkflowField` — the transition path);
   *   - `increment` targets must be numeric;
   *   - a field may not appear in BOTH `set` and `increment` (caller bug);
   *   - child cells must be declared and either the Table field or the cell
   *     itself must be `allow_on_submit`; `_row_id`/`idx` are never patchable;
   *   - an empty patch is rejected (fail loud, never write a no-op version row).
   *
   * `validateEdit` (the docstatus 1/2 hard block for `update()`) is left
   * untouched — this is the SEPARATE, narrower gate for the post-submit verb.
   */
  validateSubmittedPatch(
    entity: EntityDefinition,
    doc: BaseDocument,
    touched: SubmittedPatchTouched,
    opts: { allowWorkflowField?: boolean } = {},
  ): void {
    // 1. Only submittable entities have a submitted state at all.
    if (!entity.is_submittable) {
      throw new DocStatusError("not_submittable", { doctype: entity.name });
    }

    // 2. Only docstatus=1 is patchable. Covers docstatus 0 (use update()) and
    //    docstatus 2 (cancelled stays fully frozen).
    if (doc.docstatus !== DocStatus.Submitted) {
      throw new DocStatusError("not_submitted", {
        doctype: entity.name,
        name: doc._id,
        docstatus: String(doc.docstatus),
      });
    }

    const childEntries = touched.children ?? [];

    // 3. Empty patch — fail loud rather than writing a no-op version/activity row.
    const childHasWork = childEntries.some(
      (c) => c.setFields.length > 0 || c.incrementFields.length > 0,
    );
    if (
      touched.setFields.length === 0 &&
      touched.incrementFields.length === 0 &&
      !childHasWork
    ) {
      throw new DocStatusError("empty_submitted_patch", { doctype: entity.name });
    }

    const workflowField = entity.workflow_field ?? "status";

    // 4. A field may not be both set and incremented in one patch (caller bug).
    const incSet = new Set(touched.incrementFields);
    for (const f of touched.setFields) {
      if (incSet.has(f)) {
        throw new DocStatusError("set_increment_overlap", { doctype: entity.name, field: f });
      }
    }

    // 5 + 6. System-field rejection then band membership, for every top-level key.
    const topLevel = [...new Set([...touched.setFields, ...touched.incrementFields])];
    for (const field of topLevel) {
      if (SUBMITTED_PATCH_SYSTEM_FIELDS.has(field) || field.startsWith("_")) {
        throw new DocStatusError("field_not_allowed_on_submit", {
          doctype: entity.name,
          field,
        });
      }
      const fd = entity.fields.find((f) => f.fieldname === field);
      // The workflow field is admitted on the transition path even if unflagged —
      // but it must still be a DECLARED field (else transition() with
      // allowWorkflowField would let an arbitrary key be written to a
      // workflow-less submittable doc — the E5 hole).
      if (field === workflowField && opts.allowWorkflowField) {
        if (!fd) {
          throw new DocStatusError("field_not_allowed_on_submit", {
            doctype: entity.name,
            field,
          });
        }
        continue;
      }
      if (!fd || fd.allow_on_submit !== true) {
        throw new DocStatusError("field_not_allowed_on_submit", {
          doctype: entity.name,
          field,
        });
      }
      // Table fields are NEVER patchable via top-level set/increment — a
      // whole-array replacement would add/remove rows (structural change of the
      // frozen core) and drop _row_ids. Tables are only reachable per-row via
      // children[] (a Table-level allow_on_submit flag scopes THAT surface).
      if (fd.fieldtype === "Table") {
        throw new DocStatusError("field_not_allowed_on_submit", {
          doctype: entity.name,
          field,
        });
      }
    }

    // 7. increment targets must resolve to a numeric fieldtype.
    for (const field of touched.incrementFields) {
      const fd = entity.fields.find((f) => f.fieldname === field);
      if (!fd || !NUMERIC_TYPES.has(fd.fieldtype)) {
        throw new DocStatusError("increment_not_numeric", { doctype: entity.name, field });
      }
    }

    // 8. Children — per-row cell scoping.
    for (const c of childEntries) {
      const tableField = entity.fields.find((f) => f.fieldname === c.table);
      if (!tableField || tableField.fieldtype !== "Table") {
        throw new DocStatusError("field_not_allowed_on_submit", {
          doctype: entity.name,
          field: c.table,
        });
      }
      const tableFlagged = tableField.allow_on_submit === true;
      const childFields: FieldDefinition[] = tableField.child_fields ?? [];

      const cIncSet = new Set(c.incrementFields);
      for (const cell of c.setFields) {
        if (cIncSet.has(cell)) {
          throw new DocStatusError("set_increment_overlap", {
            doctype: entity.name,
            field: `${c.table}.${cell}`,
          });
        }
      }

      const cells = [...new Set([...c.setFields, ...c.incrementFields])];
      for (const cell of cells) {
        if (cell.startsWith("_") || cell === "idx") {
          throw new DocStatusError("field_not_allowed_on_submit", {
            doctype: entity.name,
            field: `${c.table}.${cell}`,
          });
        }
        const cf = childFields.find((x) => x.fieldname === cell);
        if (!cf || (!tableFlagged && cf.allow_on_submit !== true)) {
          throw new DocStatusError("field_not_allowed_on_submit", {
            doctype: entity.name,
            field: `${c.table}.${cell}`,
          });
        }
      }
      for (const cell of c.incrementFields) {
        const cf = childFields.find((x) => x.fieldname === cell);
        if (!cf || !NUMERIC_TYPES.has(cf.fieldtype)) {
          throw new DocStatusError("increment_not_numeric", {
            doctype: entity.name,
            field: `${c.table}.${cell}`,
          });
        }
      }
    }
  }

  /**
   * Check if a document can be deleted.
   */
  validateDelete(entity: EntityDefinition, doc: BaseDocument): void {
    if (entity.is_submittable && doc.docstatus === DocStatus.Submitted) {
      throw new DocStatusError("cannot_delete_submitted", {
        doctype: entity.name,
      });
    }

    if (entity.is_log) {
      throw new DocStatusError("cannot_delete_log", {
        doctype: entity.name,
      });
    }
  }

  /**
   * Prepare data for an amended document.
   */
  prepareAmend(entity: EntityDefinition, doc: BaseDocument): Record<string, unknown> {
    if (doc.docstatus !== DocStatus.Cancelled) {
      throw new DocStatusError("cannot_amend_not_cancelled", {
        doctype: entity.name,
        name: doc._id,
      });
    }

    // Return amended data — will be used to create a new draft
    return {
      amended_from: doc._id,
    };
  }
}
