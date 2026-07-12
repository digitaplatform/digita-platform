import type { ClientSession } from "mongodb";
import type {
  EntityDefinition,
  FieldDefinition,
  FlattenSpec,
  SnapshotManifest,
  DatabaseTarget,
} from "@digitaplatform/shared";
import { ROW_ID_FIELD } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import { parseSubRowLink } from "../document/row-id.js";
import { toIdString } from "../document/id-codec.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("snapshot-resolver");

/**
 * Thrown when a snapshot manifest's `from` field points at an id whose target
 * doc cannot be located. Aborts submit/insert so we never legally seal an
 * empty/wrong snapshot. The transaction rolls back; the user sees a clear error.
 */
export class SnapshotMissingTargetError extends Error {
  public readonly entity: string;
  public readonly fromField: string;
  public readonly targetEntity: string;
  public readonly targetId: string;
  constructor(entity: string, fromField: string, targetEntity: string, targetId: string) {
    super(
      `Snapshot for ${entity}.${fromField} cannot resolve: ` +
        `${targetEntity} ${targetId} not found`,
    );
    this.name = "SnapshotMissingTargetError";
    this.entity = entity;
    this.fromField = fromField;
    this.targetEntity = targetEntity;
    this.targetId = targetId;
  }
}

/**
 * Resolves snapshot manifests at the docstatus 0→1 transition.
 *
 * Two manifest sites:
 *   Top-level `entity.snapshot[]`: pulls fields from the parent's Link targets.
 *   Per-Table `field.snapshot[]`: pulls fields from each child row's Link targets.
 *
 * Performance: collects all distinct (collection, id) pairs first and runs ONE
 * `$in` lookup per collection, then fans out. A document with N child rows and
 * one per-row snapshot resolves in ≤5 collection-level reads regardless of N.
 */
export class SnapshotResolver {
  constructor(
    private registry: EntityRegistry,
    private db: MongoDBService,
  ) {}

  async resolve(
    entity: EntityDefinition,
    data: Record<string, unknown>,
    session?: ClientSession,
  ): Promise<Record<string, unknown>> {
    if (!entityHasAnySnapshot(entity) && !entityHasAnyFreeze(entity)) return data;

    // ─── Pass 1: collect every (collection, id, dbTarget) we need to load ───
    const lookups = new Map<string, { db: DatabaseTarget; ids: Set<string> }>();

    // Top-level snapshot manifests.
    for (const m of entity.snapshot ?? []) {
      const target = this.resolveTargetCollection(entity, data, m.from);
      if (!target) continue;
      const fromField = entity.fields.find((f) => f.fieldname === m.from);
      const id = this.lookupKeyFor(fromField, data, m.from);
      if (!id) continue;
      this.recordLookup(lookups, target.collection, target.dbTarget, id);
    }

    // Top-level freeze directives on Link fields.
    for (const field of entity.fields) {
      if (!isFreezeOn(field)) continue;
      const target = this.targetFromField(field, data);
      if (!target) continue;
      const id = this.lookupKeyFor(field, data, field.fieldname);
      if (!id) continue;
      this.recordLookup(lookups, target.collection, target.dbTarget, id);
    }

    // Per-Table-field manifests.
    for (const field of entity.fields) {
      if (field.fieldtype !== "Table" || !field.snapshot?.length) continue;
      const rows = (data[field.fieldname] ?? []) as Array<Record<string, unknown>>;
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        for (const m of field.snapshot) {
          const target = this.resolveTableTarget(field, row, m.from);
          if (!target) continue;
          const childField = field.child_fields?.find((f) => f.fieldname === m.from);
          const id = this.lookupKeyFor(childField, row, m.from);
          if (!id) continue;
          this.recordLookup(lookups, target.collection, target.dbTarget, id);
        }
      }
    }

    // Per-Table-field freeze directives on child Link fields.
    for (const field of entity.fields) {
      if (field.fieldtype !== "Table" || !field.child_fields) continue;
      const rows = (data[field.fieldname] ?? []) as Array<Record<string, unknown>>;
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        for (const childField of field.child_fields) {
          if (!isFreezeOn(childField)) continue;
          const target = this.targetFromField(childField, row);
          if (!target) continue;
          const id = this.lookupKeyFor(childField, row, childField.fieldname);
          if (!id) continue;
          this.recordLookup(lookups, target.collection, target.dbTarget, id);
        }
      }
    }

    if (lookups.size === 0) return data;

    // ─── Pass 2: bulk-load each collection ───
    const docsByKey = new Map<string, Record<string, unknown>>();
    for (const [collection, info] of lookups) {
      const ids = Array.from(info.ids);
      const rows = (await this.db.find(
        collection,
        { filters: [{ _id: { $in: ids } }], limit: ids.length },
        info.db,
        session,
      )) as Array<Record<string, unknown>>;
      for (const r of rows) {
        const id = toIdString(r["_id"]);
        if (id) docsByKey.set(`${collection}::${id}`, r);
      }
    }

    // ─── Pass 3: write snapshot fields onto a fresh copy of `data` ───
    const out: Record<string, unknown> = { ...data };

    // Top-level manifests.
    for (const m of entity.snapshot ?? []) {
      const target = this.resolveTargetCollection(entity, data, m.from);
      if (!target) continue;
      const fromField = entity.fields.find((f) => f.fieldname === m.from);
      const id = this.lookupKeyFor(fromField, data, m.from);
      if (!id) continue;
      const linked = docsByKey.get(`${target.collection}::${id}`);
      if (!linked) {
        throw new SnapshotMissingTargetError(entity.name, m.from, target.collection, id);
      }
      const source = this.selectSource(fromField, data, m.from, linked);
      if (!source) {
        throw new SnapshotMissingTargetError(entity.name, m.from, target.collection, id);
      }
      this.applyManifest(m, source, out);
    }

    // Top-level freeze directives — write `<fieldname>_snapshot` JSON sub-objects.
    for (const field of entity.fields) {
      if (!isFreezeOn(field)) continue;
      const target = this.targetFromField(field, data);
      if (!target) continue;
      const id = this.lookupKeyFor(field, data, field.fieldname);
      if (!id) continue;
      const linked = docsByKey.get(`${target.collection}::${id}`);
      if (!linked) {
        throw new SnapshotMissingTargetError(
          entity.name,
          field.fieldname,
          target.collection,
          id,
        );
      }
      const source = this.selectSource(field, data, field.fieldname, linked);
      if (!source) {
        throw new SnapshotMissingTargetError(
          entity.name,
          field.fieldname,
          target.collection,
          id,
        );
      }
      out[`${field.fieldname}_snapshot`] = this.buildFreezePayload(field, source, target.collection);
      this.applyFlatten(field, source, out);
    }

    // Per-Table-field manifests + freeze — rebuild rows.
    for (const field of entity.fields) {
      if (field.fieldtype !== "Table") continue;
      const hasManifest = !!field.snapshot?.length;
      const childFreezeFields = field.child_fields?.filter(isFreezeOn) ?? [];
      if (!hasManifest && childFreezeFields.length === 0) continue;

      const rows = (data[field.fieldname] ?? []) as Array<Record<string, unknown>>;
      if (!Array.isArray(rows)) continue;

      const newRows = rows.map((row) => {
        const newRow = { ...row };

        // Per-row manifests (existing mechanism).
        for (const m of field.snapshot ?? []) {
          const target = this.resolveTableTarget(field, row, m.from);
          if (!target) continue;
          const childField = field.child_fields?.find((f) => f.fieldname === m.from);
          const id = this.lookupKeyFor(childField, row, m.from);
          if (!id) continue;
          const linked = docsByKey.get(`${target.collection}::${id}`);
          if (!linked) {
            throw new SnapshotMissingTargetError(
              `${entity.name}.${field.fieldname}`,
              m.from,
              target.collection,
              id,
            );
          }
          const source = this.selectSource(childField, row, m.from, linked);
          if (!source) {
            throw new SnapshotMissingTargetError(
              `${entity.name}.${field.fieldname}`,
              m.from,
              target.collection,
              id,
            );
          }
          this.applyManifest(m, source, newRow);
        }

        // Per-row freeze directives.
        for (const childField of childFreezeFields) {
          const target = this.targetFromField(childField, row);
          if (!target) continue;
          const id = this.lookupKeyFor(childField, row, childField.fieldname);
          if (!id) continue;
          const linked = docsByKey.get(`${target.collection}::${id}`);
          if (!linked) {
            throw new SnapshotMissingTargetError(
              `${entity.name}.${field.fieldname}`,
              childField.fieldname,
              target.collection,
              id,
            );
          }
          const source = this.selectSource(childField, row, childField.fieldname, linked);
          if (!source) {
            throw new SnapshotMissingTargetError(
              `${entity.name}.${field.fieldname}`,
              childField.fieldname,
              target.collection,
              id,
            );
          }
          newRow[`${childField.fieldname}_snapshot`] = this.buildFreezePayload(
            childField,
            source,
            target.collection,
          );
          this.applyFlatten(childField, source, newRow);
        }

        return newRow;
      });
      out[field.fieldname] = newRows;
    }

    log.debug(
      { entity: entity.name, manifests: entity.snapshot?.length ?? 0 },
      "Snapshot resolved",
    );
    return out;
  }

  /**
   * Build the JSON sub-object stored in `<fieldname>_snapshot` for a freeze
   * directive. Four modes:
   *
   *   field.target_path set        — the source is already the sub-row
   *                                  itself; we copy it verbatim minus the
   *                                  internal `_row_id` book-keeping field.
   *   field.freeze === true        — read target's `snapshot_fields` and
   *                                  copy each. Empty/absent → empty object
   *                                  with a warning.
   *   field.freeze instanceof []   — copy exactly the listed fields.
   *   field.freeze object form     — same JSON content as `true`, but the
   *                                  fields list comes from `freeze.fields`
   *                                  (if set) instead of `snapshot_fields`.
   */
  private buildFreezePayload(
    field: FieldDefinition,
    source: Record<string, unknown>,
    targetCollection: string,
  ): Record<string, unknown> {
    if (field.target_path) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(source)) {
        if (k === ROW_ID_FIELD) continue;
        out[k] = v;
      }
      return out;
    }

    const fieldNames = this.resolveFreezeFieldList(field, targetCollection);
    if (!fieldNames) return {};

    const out: Record<string, unknown> = {};
    for (const name of fieldNames) {
      out[name] = readPath(source, name);
    }
    return out;
  }

  private resolveFreezeFieldList(
    field: FieldDefinition,
    targetCollection: string,
  ): string[] | null {
    const freeze = field.freeze;
    if (Array.isArray(freeze)) return freeze;
    if (freeze && typeof freeze === "object" && !Array.isArray(freeze)) {
      if (freeze.fields?.length) return freeze.fields;
      return this.targetSnapshotFields(field.fieldname, targetCollection);
    }
    if (freeze === true) {
      return this.targetSnapshotFields(field.fieldname, targetCollection);
    }
    return null;
  }

  private targetSnapshotFields(
    sourceFieldName: string,
    targetCollection: string,
  ): string[] | null {
    const targetEntity = this.registry.has(targetCollection)
      ? this.registry.get(targetCollection)
      : null;
    const declared = targetEntity?.snapshot_fields;
    if (!declared || declared.length === 0) {
      log.warn(
        { field: sourceFieldName, target: targetCollection },
        "freeze: target declares no snapshot_fields — empty snapshot written",
      );
      return null;
    }
    return declared;
  }

  /**
   * Apply each `flatten` directive on a freeze field by writing
   * `out[as] = readPath(source, from)`. No-op when freeze isn't the
   * object form or has no `flatten[]`.
   */
  private applyFlatten(
    field: FieldDefinition,
    source: Record<string, unknown>,
    out: Record<string, unknown>,
  ): void {
    const flatten = getFreezeFlatten(field);
    if (!flatten.length) return;
    for (const spec of flatten) {
      out[spec.as] = readPath(source, spec.from);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────

  private resolveTargetCollection(
    entity: EntityDefinition,
    data: Record<string, unknown>,
    fromFieldname: string,
  ): { collection: string; dbTarget: DatabaseTarget } | null {
    const field = entity.fields.find((f) => f.fieldname === fromFieldname);
    if (!field) return null;
    return this.targetFromField(field, data);
  }

  private resolveTableTarget(
    tableField: FieldDefinition,
    row: Record<string, unknown>,
    fromFieldname: string,
  ): { collection: string; dbTarget: DatabaseTarget } | null {
    const child = tableField.child_fields?.find((f) => f.fieldname === fromFieldname);
    if (!child) return null;
    return this.targetFromField(child, row);
  }

  private targetFromField(
    field: FieldDefinition,
    _data: Record<string, unknown>,
  ): { collection: string; dbTarget: DatabaseTarget } | null {
    if (field.fieldtype !== "Link") return null;
    const collection = field.target;
    if (!collection) return null;
    if (!this.registry.has(collection)) return null;
    const target = this.registry.get(collection);
    return { collection, dbTarget: target.database };
  }

  private linkIdAt(data: Record<string, unknown>, fromFieldname: string): string | null {
    const v = data[fromFieldname];
    return typeof v === "string" && v.length > 0 ? v : null;
  }

  /**
   * The "lookup key" for the bulk-load step. For a regular Link,
   * this is the stored value (the parent doc's `_id`). For a `target_path`
   * sub-row Link, the value is composite `<parent_id>::<row_id>` and we need
   * the parent id only — the row is located later inside `selectSource`.
   */
  private lookupKeyFor(
    field: FieldDefinition | undefined,
    data: Record<string, unknown>,
    fromFieldname: string,
  ): string | null {
    const raw = this.linkIdAt(data, fromFieldname);
    if (!raw) return null;
    if (field?.target_path) {
      const parsed = parseSubRowLink(raw);
      return parsed?.parentId ?? null;
    }
    return raw;
  }

  /**
   * Pick the actual source object whose fields will be embedded by the
   * manifest. For regular Links, that's the linked parent doc. For
   * `target_path` sub-row Links, it's the row inside `linked[target_path]`
   * matching the row id from the composite Link value.
   */
  private selectSource(
    field: FieldDefinition | undefined,
    data: Record<string, unknown>,
    fromFieldname: string,
    linkedParent: Record<string, unknown>,
  ): Record<string, unknown> | null {
    if (!field?.target_path) return linkedParent;
    const raw = this.linkIdAt(data, fromFieldname);
    if (!raw) return null;
    const parsed = parseSubRowLink(raw);
    if (!parsed) return null;
    const rows = linkedParent[field.target_path];
    if (!Array.isArray(rows)) return null;
    const row = rows.find((r) => (r as Record<string, unknown>)[ROW_ID_FIELD] === parsed.rowId) as
      | Record<string, unknown>
      | undefined;
    return row ?? null;
  }

  private recordLookup(
    lookups: Map<string, { db: DatabaseTarget; ids: Set<string> }>,
    collection: string,
    dbTarget: DatabaseTarget,
    id: string,
  ): void {
    let bucket = lookups.get(collection);
    if (!bucket) {
      bucket = { db: dbTarget, ids: new Set() };
      lookups.set(collection, bucket);
    }
    bucket.ids.add(id);
  }

  private applyManifest(
    m: SnapshotManifest,
    linked: Record<string, unknown>,
    target: Record<string, unknown>,
  ): void {
    for (const [fieldOnParent, sourcePath] of Object.entries(m.fields)) {
      target[fieldOnParent] = readPath(linked, sourcePath);
    }
  }
}

function readPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur ?? null;
}

export function entityHasAnySnapshot(entity: EntityDefinition): boolean {
  if (entity.snapshot?.length) return true;
  for (const f of entity.fields) {
    if (f.fieldtype === "Table" && f.snapshot?.length) return true;
  }
  return false;
}

/**
 * Whether the field carries an *active* freeze directive (true, non-empty
 * override list, or an object form with `fields` or `flatten`).
 * `freeze: false` is an explicit opt-out and is treated as absent here —
 * it satisfies the boot-time coverage lint without requesting any runtime
 * work.
 */
export function isFreezeOn(field: FieldDefinition): boolean {
  const f = field.freeze;
  if (f === true) return true;
  if (Array.isArray(f) && f.length > 0) return true;
  if (f && typeof f === "object" && !Array.isArray(f)) {
    return !!(f.fields?.length || f.flatten?.length);
  }
  return false;
}

/**
 * Extract the `flatten[]` list from a field's freeze directive. Returns
 * an empty array for non-object freeze forms or when `flatten` is absent.
 */
export function getFreezeFlatten(field: FieldDefinition): FlattenSpec[] {
  const f = field.freeze;
  if (f && typeof f === "object" && !Array.isArray(f)) {
    return f.flatten ?? [];
  }
  return [];
}

export function entityHasAnyFreeze(entity: EntityDefinition): boolean {
  for (const f of entity.fields) {
    if (isFreezeOn(f)) return true;
    if (f.fieldtype === "Table" && f.child_fields) {
      for (const cf of f.child_fields) {
        if (isFreezeOn(cf)) return true;
      }
    }
  }
  return false;
}
