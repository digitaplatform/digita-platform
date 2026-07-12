import type { EntityDefinition, FieldDefinition } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import { toIdString } from "../document/id-codec.js";

/** entityName -> (businessKeyValue -> idString) */
export type BkIndex = Map<string, Map<string, string>>;

/** A Link value that references a bk-bearing target but matched no known bk. */
export interface UnresolvedLink {
  field: string;
  target: string;
  value: string;
}

/** The field name(s) that form an entity's human-facing business key, normalized. */
export function businessKeyFields(entity: EntityDefinition): string[] {
  const bk = entity.business_key;
  if (!bk) return [];
  return Array.isArray(bk) ? bk : [bk];
}

/** Index key for a row's business key (single value, or composite joined). */
export function businessKeyOf(
  row: Record<string, unknown>,
  fields: string[],
): string | undefined {
  if (fields.length === 1) {
    const v = row[fields[0]!];
    return v == null ? undefined : String(v);
  }
  if (fields.length === 0) return undefined;
  if (fields.some((f) => row[f] == null)) return undefined;
  // Collision-proof INTERNAL index key: join composite parts with NUL (which can
  // never appear in a real field value), exactly as the boot seed loader always
  // did — so the extraction is behavior-identical. A printable separator (space)
  // is unsafe: ("a b","c") and ("a","b c") would collide. This key is never
  // exported; composite-bk export is fail-loud-guarded in idToBkMap.
  return fields.map((f) => String(row[f])).join("\x00");
}

/**
 * Replace any Link value that equals a known business key with the target's
 * `_id`, recursing into `Table.child_fields`. Mutates `row` in place.
 *
 * Returns the Link values that reference a bk-bearing, indexed target but
 * matched nothing (the caller decides whether that is a fail-loud row error).
 * A Link whose target is NOT in `bkIndex` (no business key declared → `_id`
 * IS the readable key) is left untouched and never reported — same lenient
 * precedence as the seed loader.
 */
export function resolveLinksByBk(
  fields: FieldDefinition[],
  row: Record<string, unknown>,
  bkIndex: BkIndex,
): UnresolvedLink[] {
  const unresolved: UnresolvedLink[] = [];
  for (const field of fields) {
    if (field.fieldtype === "Link" && field.target) {
      const v = row[field.fieldname];
      if (v == null) continue;
      const targetIdx = bkIndex.get(field.target);
      if (!targetIdx) continue; // target has no bk — value IS the id
      const resolved = targetIdx.get(String(v));
      if (resolved !== undefined) {
        row[field.fieldname] = resolved;
      } else {
        unresolved.push({ field: field.fieldname, target: field.target, value: String(v) });
      }
    } else if (field.fieldtype === "Table" && Array.isArray(row[field.fieldname])) {
      const childFields = field.child_fields ?? [];
      for (const child of row[field.fieldname] as Record<string, unknown>[]) {
        unresolved.push(...resolveLinksByBk(childFields, child, bkIndex));
      }
    }
  }
  return unresolved;
}

/**
 * The business-key ↔ `_id` resolver, extracted from the boot-only seed loader
 * (`seed-app-data.ts`) so the seed loader AND the master-data import pipeline
 * share ONE implementation. Every branch is metadata-driven (`business_key`,
 * `target`, `child_fields`, `tree.parent_field` is just a self-Link) — zero
 * entity-specific logic.
 */
export class BkResolver {
  constructor(
    private registry: EntityRegistry,
    private db: MongoDBService,
  ) {}

  /**
   * Fill `idx` with the bk → `_id` map of `entity`'s existing rows via a
   * targeted projection (not a full document scan). Preserves the seed loader's
   * `if (!idx.has(bk))` precedence — pre-existing entries (uploaded/pass-2) win.
   */
  async indexEntity(entity: EntityDefinition, idx: Map<string, string>): Promise<void> {
    const bkFields = businessKeyFields(entity);
    if (!bkFields.length) return;
    const existing = await this.db.find(
      entity.name,
      { fields: ["_id", ...bkFields] },
      entity.database,
    );
    for (const doc of existing) {
      const d = doc as Record<string, unknown>;
      const bk = businessKeyOf(d, bkFields);
      if (bk !== undefined && !idx.has(bk)) idx.set(bk, toIdString(d["_id"]));
    }
  }

  /**
   * Build a bk index for every bk-bearing Link target of `entity` (top-level
   * and inside every Table's `child_fields`, incl. self-links / tree parents),
   * plus the entity itself when `includeSelf` (upsert / self-referential files).
   * Targets without a business key are skipped — their `_id` IS the readable key.
   */
  async indexLinkTargets(
    entity: EntityDefinition,
    opts: { includeSelf?: boolean } = {},
  ): Promise<BkIndex> {
    const targets = new Set<string>();
    const collect = (fields: FieldDefinition[]): void => {
      for (const f of fields) {
        if (f.fieldtype === "Link" && f.target) targets.add(f.target);
        else if (f.fieldtype === "Table" && f.child_fields) collect(f.child_fields);
      }
    };
    collect(entity.fields);
    if (opts.includeSelf) targets.add(entity.name);

    const idx: BkIndex = new Map();
    for (const targetName of targets) {
      if (!this.registry.has(targetName)) continue;
      const target = this.registry.get(targetName);
      if (!businessKeyFields(target).length) continue;
      const map = new Map<string, string>();
      await this.indexEntity(target, map);
      idx.set(targetName, map);
    }
    return idx;
  }

  /**
   * Reverse map `_id` → business key for the export round-trip: ONE batched
   * `$in` find per target (no N+1). `_id: {$in: hex-strings}` is normalized to
   * ObjectIds by buildMongoFilter for `system`-named targets.
   */
  async idToBkMap(entity: EntityDefinition, ids: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const bkFields = businessKeyFields(entity);
    if (!bkFields.length || ids.length === 0) return map;
    // A composite bk's internal key is NUL-joined (collision-proof) — emitting it
    // into a single export cell needs a defined component-escaping scheme, which
    // is out of MVP scope. Fail loud rather than write an unusable NUL-laced cell.
    if (bkFields.length > 1) {
      throw new Error(
        `export link_format=business_key is not yet supported for '${entity.name}' — ` +
          `it has a COMPOSITE business key (${bkFields.join(", ")}); a composite key ` +
          `needs a defined cell-escaping scheme first`,
      );
    }
    const docs = await this.db.find(
      entity.name,
      { filters: [{ _id: { $in: ids } }], fields: ["_id", ...bkFields] },
      entity.database,
    );
    for (const doc of docs) {
      const d = doc as Record<string, unknown>;
      const bk = businessKeyOf(d, bkFields);
      if (bk !== undefined) map.set(toIdString(d["_id"]), bk);
    }
    return map;
  }
}
