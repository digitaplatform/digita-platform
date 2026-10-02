import { readFile } from "fs/promises";
import { join } from "path";
import { injectRowIds } from "../document/base-document.js";
import { deepEqual } from "../document/change-tracker.js";
import { serializeRowForStorage } from "../import-export/row-serializer.js";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityDefinition } from "@digitaplatform/shared";
import { carryRowIds, keepEqualStoredPasswords } from "./seed-app-data.js";

/** A settings field whose stored value is still the demo tier's, with what it goes back to. */
export interface DemoValue {
  entity: string;
  field: string;
  /** The reference tier's value as stored, or null where the reference tier sets none. */
  reference: unknown;
}

/** The one row a seed file of an `is_single` entity declares in the first of `dirs` that has one. */
async function findSeedRow(dirs: string[], entity: string): Promise<Record<string, unknown> | undefined> {
  for (const dir of dirs) {
    let raw: string;
    try {
      raw = await readFile(join(dir, `${entity}.seed.json`), "utf-8");
    } catch {
      continue;
    }
    const rows = JSON.parse(raw) as unknown;
    if (Array.isArray(rows) && rows[0] && typeof rows[0] === "object") return rows[0] as Record<string, unknown>;
  }
  return undefined;
}

/**
 * The fields of the settings records that still hold what the demo tier wrote. Each demo value is
 * compared as the seed stores it: a Table with the stored row ids, a Password by its clear text.
 * A field a person set differs and is not listed; so is one whose demo value equals its reference
 * value. A demo value of an older version of the seed no longer equals the file and is not found.
 */
export async function listDemoValues(
  db: MongoDBService,
  settings: EntityDefinition[],
  referenceDirs: string[],
  demoDirs: string[],
): Promise<DemoValue[]> {
  const found: DemoValue[] = [];
  for (const entity of settings) {
    const demoRow = await findSeedRow(demoDirs, entity.name);
    if (!demoRow) continue;
    const [stored] = (await db.find(entity.name, { limit: 1 }, entity.database)) as Record<string, unknown>[];
    if (!stored) continue;
    const demo = serializeRowForStorage(entity, demoRow);
    keepEqualStoredPasswords(entity, demoRow, demo, stored);
    carryRowIds(demo, stored);
    const referenceRow = (await findSeedRow(referenceDirs, entity.name)) ?? {};
    const reference = serializeRowForStorage(entity, referenceRow);
    keepEqualStoredPasswords(entity, referenceRow, reference, stored);
    carryRowIds(reference, stored);
    for (const field of entity.fields) {
      const key = field.fieldname;
      if (!(key in demo) || !deepEqual(demo[key], stored[key])) continue;
      const back = reference[key] ?? null;
      if (deepEqual(back, stored[key])) continue;
      found.push({ entity: entity.name, field: key, reference: back });
    }
  }
  return found;
}

/** Sets each listed field back to its reference value, on the settings record that holds it. */
export async function restoreReferenceValues(db: MongoDBService, settings: EntityDefinition[], values: DemoValue[]): Promise<void> {
  for (const entity of settings) {
    const changes: Record<string, unknown> = {};
    for (const value of values) if (value.entity === entity.name) changes[value.field] = value.reference;
    if (Object.keys(changes).length === 0) continue;
    injectRowIds(changes);
    const [stored] = (await db.find(entity.name, { limit: 1, fields: ["_id"] }, entity.database)) as Record<string, unknown>[];
    await db.updateOne(entity.name, String(stored!["_id"]), { ...changes, modified: new Date() }, entity.database);
  }
}
