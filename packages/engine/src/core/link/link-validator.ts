import type { EntityDefinition, FieldDefinition } from "@digitaplatform/shared";
import { ROW_ID_FIELD } from "@digitaplatform/shared";
import type { ClientSession } from "mongodb";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import { parseSubRowLink } from "../document/row-id.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("link-validator");

export interface LinkValidationError {
  field: string;
  target: string;
  value: string;
  message_key: string;
  params: Record<string, string>;
}

/**
 * Validate all Link fields in a document point to existing documents.
 */
export class LinkValidator {
  constructor(
    private registry: EntityRegistry,
    private db: MongoDBService,
  ) {}

  async validate(
    entity: EntityDefinition,
    data: Record<string, unknown>,
    /** The caller's transaction session — threaded to the existence reads so a
     *  link target created earlier in the SAME transaction is visible (a sessionless
     *  read runs outside the tx and would spuriously fail with link_not_found). */
    session?: ClientSession,
  ): Promise<LinkValidationError[]> {
    const errors: LinkValidationError[] = [];

    // Validate top-level Link fields
    for (const field of entity.fields) {
      if (field.fieldtype === "Link" && field.target) {
        const value = data[field.fieldname];
        if (!value) continue;
        await this.checkLink(field, String(value), field.fieldname, errors, session);
        continue;
      }

      // Validate Link fields inside child tables
      if (field.fieldtype === "Table" && field.child_fields) {
        const rows = data[field.fieldname];
        if (!Array.isArray(rows)) continue;

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i] as Record<string, unknown>;
          for (const childField of field.child_fields) {
            const childPath = `${field.fieldname}[${i}].${childField.fieldname}`;
            if (childField.fieldtype === "Link" && childField.target) {
              const value = row[childField.fieldname];
              if (!value) continue;
              await this.checkLink(childField, String(value), childPath, errors, session);
            }
          }
        }
      }
    }

    return errors;
  }

  /**
   * Validate a single Link value. When the field declares `target_path`, the
   * value is treated as a composite `<parent_id>::<row_id>` pointing at a
   * row inside the named Table on the parent doc. Otherwise the value is
   * the parent doc's own `_id`.
   */
  private async checkLink(
    field: FieldDefinition,
    value: string,
    fieldPath: string,
    errors: LinkValidationError[],
    session?: ClientSession,
  ): Promise<void> {
    if (!field.target) return;

    if (field.target_path) {
      const parsed = parseSubRowLink(value);
      if (!parsed) {
        errors.push({
          field: fieldPath,
          target: field.target,
          value,
          message_key: "link_subrow_malformed",
          params: { target: field.target, value, expected: "<parent_id>::<row_id>" },
        });
        return;
      }
      const targetDb = this.registry.get(field.target).database;
      const parent = await this.db.findOne(field.target, parsed.parentId, targetDb, session);
      if (!parent) {
        errors.push({
          field: fieldPath,
          target: field.target,
          value,
          message_key: "link_not_found",
          params: { target: field.target, value: parsed.parentId },
        });
        return;
      }
      const rows = (parent as Record<string, unknown>)[field.target_path];
      if (!Array.isArray(rows)) {
        errors.push({
          field: fieldPath,
          target: field.target,
          value,
          message_key: "link_subrow_table_missing",
          params: { target: field.target, table: field.target_path },
        });
        return;
      }
      const hit = rows.some((r) => (r as Record<string, unknown>)[ROW_ID_FIELD] === parsed.rowId);
      if (!hit) {
        errors.push({
          field: fieldPath,
          target: field.target,
          value,
          message_key: "link_subrow_not_found",
          params: { target: field.target, table: field.target_path, row: parsed.rowId },
        });
      }
      return;
    }

    const targetDb = this.registry.get(field.target).database;
    const exists = await this.db.exists(field.target, value, targetDb, session);
    if (!exists) {
      errors.push({
        field: fieldPath,
        target: field.target,
        value,
        message_key: "link_not_found",
        params: { target: field.target, value },
      });
    }
  }
}
