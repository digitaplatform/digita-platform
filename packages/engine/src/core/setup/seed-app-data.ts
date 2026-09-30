import { readdir, readFile } from "fs/promises";
import { basename, join } from "path";
import { ObjectId } from "mongodb";
import { ROW_ID_FIELD, type EntityDefinition } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import { DeleteBlockedError, NotFoundError, type DocumentService } from "../document/document-service.js";
import type { NamingService } from "../document/naming-service.js";
import { SYSTEM_ROLES, type UserContext } from "../permissions/types.js";
import { injectRowIds } from "../document/base-document.js";
import { deepEqual } from "../document/change-tracker.js";
import { toIdString } from "../document/id-codec.js";
import {
  BkResolver,
  businessKeyFields,
  businessKeyOf,
  resolveLinksByBk,
} from "../import-export/bk-resolver.js";
import { serializeRowForStorage } from "../import-export/row-serializer.js";
import {
  SnapshotResolver,
  entityHasAnySnapshot,
  entityHasAnyFreeze,
} from "../snapshot/snapshot-resolver.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("seed-app-data");

type CollectedRow = Record<string, unknown> & { __seedId?: string | ObjectId };
interface Collected {
  entity: EntityDefinition;
  rows: CollectedRow[];
  file: string;
}

/**
 * Seed per-app-dir data fixtures.
 *
 * File naming convention: the basename IS the entity's `name`, byte-for-byte
 * (case-sensitive). E.g. entity "Role" -> `Role.seed.json`.
 *   `<appDir>/seeds/<EntityName>.seed.json`
 *   `<appDir>/<domain>/seeds/<EntityName>.seed.json`   (domain-split layout)
 *
 * Content: plain JSON array of row objects using entity-schema fieldnames (snake_case).
 *
 * `_id` handling (see docs/guides/id-concept.md):
 *  - Omit `_id` from seed rows. The engine assigns it: a native ObjectId for
 *    `system` naming, an auto_increment string for `auto_increment`, etc.
 *  - Reference a target by its **business key** (e.g. a product_no), not its `_id`.
 *    The loader resolves business-key → assigned `_id` across all seed files (a row
 *    may reference a target defined in another file, in any order). Values that are
 *    not a known business key are left untouched, so seeds that still carry explicit
 *    `_id`s and reference by `_id` keep working unchanged (non-breaking).
 *
 * is_single entities: the file MUST contain exactly one row.
 *
 * Two modes:
 *  - `insert` (default): skip rows whose `_id` already exists. The reference and demo
 *    tiers use it, so a runtime edit survives every boot. Nothing is deleted. One
 *    exception layers the tiers: a row whose `_id` an earlier seed dir of the same call
 *    also carries (the demo company's values for the reference tier's neutral settings)
 *    sets its fields on the stored row while the seed still owns it (`owner` and
 *    `modified_by` are `system`); a row a person changed stays. Both tiers must load in
 *    one call for this, the earlier first.
 *  - `upsert-delete`: first the rows of `site` that the seed does not carry are deleted
 *    when the seed itself wrote them and no person changed them since (`owner` and
 *    `modified_by` are `system`, as this loader writes them); a row a person created or
 *    last changed stays and is logged. Then a row whose `_id` exists is replaced by the
 *    seed row (its `creation` and `owner` carried forward) and a new row is inserted.
 *    A delete another row still links to (a menu item's page) is refused by the document
 *    service and retried after the write, as the seed may have rewritten the linking
 *    row; the retry reads the row again and keeps it once a person changed it meanwhile;
 *    a row still linked after that stays and is logged with the linking entity.
 *    `system` is also the identity a rule action writes as when no user triggered it
 *    (rules/actions/create-document.ts, update-document.ts), so a row such a rule
 *    creates for the site is swept as if the seed wrote it. The website engine uses it for
 *    `sites/<SITE_ID>/`: site content is Git-owned, the catalog is the whole truth of a
 *    site, so a page dropped from the catalog leaves the live site at the next boot.
 *    The delete takes the path an API delete takes (the document service), so hooks and
 *    the activity log see it as any delete; the caller runs it after the app's hooks are
 *    loaded. Rows of another site are never read.
 */
export type SeedOptions =
  | { mode?: "insert" }
  | { mode: "upsert-delete"; site: string; documentService: DocumentService };

/** The identity this loader writes into `owner` and `modified_by`, and deletes as. */
const SEED_IDENTITY = "system";
const SEED_USER: UserContext = { _id: SEED_IDENTITY, email: SEED_IDENTITY, roles: [SYSTEM_ROLES.ADMINISTRATOR] };
/** True when this loader wrote the row and no person changed it since. */
const seedWrote = (doc: Record<string, unknown>) =>
  doc.owner === SEED_IDENTITY && doc.modified_by === SEED_IDENTITY;

export async function seedAppData(
  db: MongoDBService,
  registry: EntityRegistry,
  namingService: NamingService,
  seedDirs: string[],
  options: SeedOptions = {},
): Promise<void> {
  const mode = options.mode ?? "insert";
  // ── Pass 1: collect + validate every seed file across all dirs ──────
  const collected: Collected[] = [];
  for (const dir of seedDirs) {
    let files: string[];
    try {
      const entries = await readdir(dir);
      files = entries.filter((f) => f.endsWith(".seed.json"));
    } catch {
      continue; // dir doesn't exist — nothing to seed
    }

    for (const file of files) {
      const entityName = basename(file, ".seed.json");
      if (!registry.has(entityName)) {
        const ciHit = registry
          .getAll()
          .find((e) => e.name.toLowerCase() === entityName.toLowerCase());
        log.error(
          { file: join(dir, file), entity: entityName, did_you_mean: ciHit?.name },
          ciHit
            ? `seed file skipped: "${entityName}" does not match entity "${ciHit.name}" ` +
                `(names are case-sensitive) — rename to ${ciHit.name}.seed.json`
            : "seed file skipped: no registered entity matches this filename",
        );
        continue;
      }
      const entity = registry.get(entityName);

      let rows: CollectedRow[];
      try {
        const raw = await readFile(join(dir, file), "utf-8");
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error("top-level JSON must be an array");
        rows = parsed as CollectedRow[];
      } catch (e) {
        log.error({ file: join(dir, file), err: (e as Error).message }, "seed file parse failed");
        continue;
      }

      if (entity.is_single && rows.length !== 1) {
        log.error(
          { file: join(dir, file), entity: entity.name, rows: rows.length },
          "seed file skipped: an is_single entity must declare exactly one row",
        );
        continue;
      }

      // user_set naming has no way to derive an _id — require it explicitly.
      if (entity.naming?.strategy === "user_set" && rows.some((r) => r["_id"] == null)) {
        log.error(
          { file: join(dir, file), entity: entity.name },
          "seed file skipped: user_set naming requires an explicit _id on every row",
        );
        continue;
      }

      // Idempotency lint for auto_increment: a re-run regenerates fresh string
      // IDs and double-inserts. `system` naming is exempt — its idempotency comes
      // from the business_key unique index, not from a stable _id.
      if (entity.naming?.strategy === "auto_increment") {
        const missing = rows.reduce((n, r) => (r["_id"] == null ? n + 1 : n), 0);
        if (missing > 0) {
          log.warn(
            { file: join(dir, file), entity: entity.name, rows_without_id: missing, total_rows: rows.length },
            "seed file is NOT idempotent: auto_increment entity has rows without explicit _id — " +
              "a re-run will create duplicates. Add an explicit _id or use `system` naming + a business_key.",
          );
        }
      }

      collected.push({ entity, rows, file: join(dir, file) });
    }
  }

  // ── Pass 2: assign _ids + build the business-key → _id index ────────
  // bkIndex: entityName -> (businessKeyValue -> idString)
  const bkIndex = new Map<string, Map<string, string>>();
  for (const { entity, rows } of collected) {
    const prefix = entity.naming?.prefix ?? "";
    const padLength = entity.naming?.pad_length ?? 5;
    const isAutoInc = entity.naming?.strategy === "auto_increment";
    const isSystem = entity.naming?.strategy === "system";
    const isExpression = entity.naming?.strategy === "expression";

    // Pre-reserve an auto_increment range for rows lacking an explicit _id.
    let nextSeq = 0;
    if (isAutoInc) {
      const need = rows.filter((r) => r["_id"] == null).length;
      if (need > 0) {
        nextSeq = await db.getNextSequence(entity.name, "naming_seq", entity.database);
        if (need > 1) {
          await db.setSequenceValue(entity.name, "naming_seq", nextSeq + need - 1, entity.database);
        }
      }
    }

    const bkFields = businessKeyFields(entity);
    const idx = bkFields.length ? (bkIndex.get(entity.name) ?? new Map()) : undefined;
    if (idx) bkIndex.set(entity.name, idx);

    for (const row of rows) {
      if (row["_id"] != null) {
        row.__seedId = String(row["_id"]);
      } else if (isSystem) {
        row.__seedId = new ObjectId(); // native system id (see id-codec / docs/guides/id-concept.md)
      } else if (isExpression) {
        // Deferred: an expression _id (e.g. {warehouse}-{product}) is computed in
        // pass 3b, AFTER its Link references resolve to their targets' _ids.
      } else {
        row.__seedId = `${prefix}${String(nextSeq).padStart(padLength, "0")}`;
        nextSeq++;
      }

      if (idx && row.__seedId != null) {
        const bk = businessKeyOf(row, bkFields);
        if (bk !== undefined) idx.set(bk, toIdString(row.__seedId));
      }
    }
  }

  // Also index already-seeded rows so references can resolve against targets that
  // exist in the DB from a previous run (non-destructive top-up). Shared with the
  // import pipeline via BkResolver.indexEntity (same targeted-projection pattern +
  // `!idx.has(bk)` precedence). The `!bkFields.length` guard stays HERE so bk-less
  // fixtures never reach indexEntity (the guards suite mocks a db without `find`).
  const bkResolver = new BkResolver(registry, db);
  for (const { entity } of collected) {
    if (!businessKeyFields(entity).length) continue;
    await bkResolver.indexEntity(entity, bkIndex.get(entity.name)!);
  }

  // ── Pass 3: resolve Link references by business key ─────────────────
  for (const { entity, rows } of collected) {
    for (const row of rows) resolveLinksByBk(entity.fields, row, bkIndex);
  }

  // ── Pass 3b: compute deferred expression _ids ───────────────────────
  // Now that Link references resolved to their targets' _ids, an expression
  // like {warehouse}-{product} renders the same composite key the runtime
  // hooks build — so seeded and hook-created rows share one _id convention.
  for (const { entity, rows } of collected) {
    if (entity.naming?.strategy !== "expression") continue;
    for (const row of rows) {
      if (row.__seedId == null && row["_id"] == null) {
        row.__seedId = await namingService.generateId(entity, row);
      }
    }
  }

  // ── Pass 3c: in upsert-delete mode, delete the site's rows the seed no longer carries ──
  // Before Pass 4: a stale row can hold a unique key (WebPage's site, locale, slug) that
  // a carried row now needs, and the write would fail on it at every boot. One sweep per
  // entity over the ids of every seed dir: two dirs may each carry a file of the same
  // entity, and a sweep per file would delete what the other seeded. A delete the document
  // service refuses because a stored row still links the row is retried after Pass 4.
  const blocked: Array<{ entity: EntityDefinition; ids: string[] }> = [];
  if (options.mode === "upsert-delete") {
    for (const { entity, seeded } of seededIdsByEntity(collected).values()) {
      const stale = await findSiteRowsTheSeedWroteAndDoesNotCarry(db, entity, seeded, options.site);
      const { blocked: ids } = await deleteSiteRows(options.documentService, entity, stale, options.site);
      if (ids.size > 0) blocked.push({ entity, ids: [...ids.keys()] });
    }
  }

  // ── Pass 4: insert (non-destructive, chunked); upsert-delete replaces existing rows ──
  // The ids of every entity that the files already written carry: a later file's row of
  // such an id layers its fields on the stored row in insert mode.
  const carriedByEarlierFiles = new Map<string, Set<string>>();
  for (const { entity, rows } of collected) {
    const carried = carriedByEarlierFiles.get(entity.name) ?? new Set<string>();
    await insertRows(db, entity, rows, mode === "insert" ? "insert" : "upsert", carried);
    for (const row of rows) carried.add(toIdString(row.__seedId ?? String(row["_id"])));
    carriedByEarlierFiles.set(entity.name, carried);
  }

  // ── Pass 4b: retry the deletes a stored row blocked, now that the seed rewrote its rows ──
  // A link that survives comes from a row the sweep did not delete or from a carried row the
  // seed itself points at the page, so the page stays. Pass 4's writes lie between the Pass 3c
  // check and this retry, and a person may have changed the row through another engine
  // meanwhile, so each row is read again and stays unless it still carries the seed's identity.
  if (options.mode === "upsert-delete") {
    for (const { entity, ids } of blocked) {
      const retry: string[] = [];
      for (const id of ids) {
        const row = await db.findOne(entity.name, id, entity.database);
        if (row != null && !seedWrote(row)) {
          log.warn(
            { entity: entity.name, db: entity.database, site: options.site, id },
            "seed-app-data: a row the seed does not carry stays, a person changed it since the sweep",
          );
          continue;
        }
        retry.push(id);
      }
      const { blocked: still } = await deleteSiteRows(options.documentService, entity, retry, options.site);
      for (const [id, blockers] of still) {
        log.error(
          { entity: entity.name, id, blockers },
          "seed-app-data: a row the seed does not carry stays, another row still links it",
        );
      }
    }
  }

  // ── Pass 5: seal snapshot/freeze fields for seeded SUBMITTED docs ────
  // Snapshots + freeze-flatten fields (e.g. customer_name_at_doc, product_name_at_*,
  // <link>_snapshot) are normally resolved at the docstatus 0→1 submit boundary. But
  // seeded docs are raw-inserted already at docstatus 1 and never pass through submit,
  // so those frozen fields stay blank — reports (which read them) print empty. This
  // runs AFTER Pass 4 so every cross-file link target already exists; it resolves each
  // submitted row's snapshots and writes the delta. Generic: any app with snapshots/
  // freeze benefits, and freeze semantics stay in one place (SnapshotResolver). Drafts
  // (docstatus 0) are left untouched — they snapshot at their real submit.
  const snapshotResolver = new SnapshotResolver(registry, db);
  let sealed = 0;
  let skippedSeal = 0;
  for (const { entity, rows } of collected) {
    if (!entityHasAnySnapshot(entity) && !entityHasAnyFreeze(entity)) continue;
    for (const row of rows) {
      if (Number(row["docstatus"] ?? 0) < 1) continue;
      // The assigned id lives in __seedId — a native ObjectId for `system` naming,
      // a string for user_set/auto_increment/expression. row["_id"] is only set when
      // the seed file carried one explicitly. Reading row["_id"] alone silently
      // SKIPPED every `system`-named entity (its id is minted as an ObjectId into
      // __seedId, never as a string on the row) → freeze/snapshot sealing was a no-op
      // for the common case. Resolve the id exactly like Pass 4 (toIdString), so
      // updateOne's toIdStorage round-trips it back to the stored ObjectId.
      const rawId = row.__seedId ?? row["_id"];
      if (rawId == null) continue;
      const id = toIdString(rawId);
      try {
        const resolved = (await snapshotResolver.resolve(entity, row)) as Record<string, unknown>;
        const { _id: _ignore, ...delta } = resolved;
        // Through the same serialization as Pass 4, so a Password value is written back encrypted.
        await db.updateOne(entity.name, id, serializeRowForStorage(entity, delta), entity.database);
        sealed++;
      } catch (err) {
        // Seed backfill must not abort the entire reseed because ONE demo row has a
        // dangling reference (e.g. a JournalEntry line pointing at a missing Account).
        // A real submit rightly rejects that — but demo seeding is lenient elsewhere
        // too (Pass 4 tolerates dup keys; resolveLinks leaves unresolved values). Warn
        // loudly so the broken seed reference is visible, then leave this row's frozen
        // fields blank and continue sealing the rest. NOT a silent fallback: it's logged.
        skippedSeal++;
        log.warn(
          { entity: entity.name, id, err: (err as Error).message },
          "Pass 5: could not seal snapshot/freeze for a seeded submitted row — skipped; fix the referenced seed data",
        );
      }
    }
  }
  if (sealed > 0 || skippedSeal > 0) {
    log.info({ sealed, skippedSeal }, "Sealed snapshot/freeze fields on seeded submitted docs");
  }
}

function seededIdsByEntity(collected: Collected[]): Map<string, { entity: EntityDefinition; seeded: Set<string> }> {
  const byEntity = new Map<string, { entity: EntityDefinition; seeded: Set<string> }>();
  for (const { entity, rows } of collected) {
    const { seeded } = byEntity.get(entity.name) ?? { seeded: new Set<string>() };
    for (const row of rows) seeded.add(toIdString(row.__seedId ?? String(row["_id"])));
    byEntity.set(entity.name, { entity, seeded });
  }
  return byEntity;
}

/**
 * Only the site's rows are read: `site` is the field every seeded page and menu carries.
 * A row a person created or last changed is the one thing the catalog cannot know, so it
 * stays whatever the seed carries, and the log names it on every boot.
 */
async function findSiteRowsTheSeedWroteAndDoesNotCarry(
  db: MongoDBService,
  entity: EntityDefinition,
  seeded: Set<string>,
  site: string,
): Promise<string[]> {
  const stored = await db.find(
    entity.name,
    { filters: [{ site }], fields: ["_id", "owner", "modified_by"] },
    entity.database,
  );
  const unseeded = stored.filter((doc) => !seeded.has(toIdString(String(doc._id))));
  const kept = unseeded.filter((doc) => !seedWrote(doc)).map((doc) => toIdString(String(doc._id)));
  if (kept.length > 0) {
    log.warn(
      { entity: entity.name, db: entity.database, site, kept: kept.length, ids: kept },
      "seed-app-data: rows the seed does not carry stay, a person created or changed them",
    );
  }
  return unseeded.filter(seedWrote).map((doc) => toIdString(String(doc._id)));
}

/** Deletes through the document service; returns the rows another row still links, with the link. */
async function deleteSiteRows(
  documentService: DocumentService,
  entity: EntityDefinition,
  ids: string[],
  site: string,
): Promise<{ blocked: Map<string, DeleteBlockedError["blockers"]> }> {
  const deleted: string[] = [];
  const blocked = new Map<string, DeleteBlockedError["blockers"]>();
  for (const id of ids) {
    try {
      await documentService.deleteDoc(entity.name, id, SEED_USER);
      deleted.push(id);
    } catch (err) {
      // Another engine of the same site booting at the same time deleted it first.
      if (err instanceof NotFoundError) continue;
      if (err instanceof DeleteBlockedError) {
        blocked.set(id, err.blockers);
        continue;
      }
      // One failed row must not hide the rest of the sweep.
      log.error(
        { entity: entity.name, id, err: (err as Error).message },
        "seed-app-data: could not delete a row the seed does not carry",
      );
    }
  }
  if (deleted.length > 0) {
    log.info(
      { entity: entity.name, db: entity.database, site, deleted: deleted.length, ids: deleted },
      "seed-app-data: deleted rows the seed no longer carries",
    );
  }
  return { blocked };
}

async function insertRows(
  db: MongoDBService,
  entity: EntityDefinition,
  rows: CollectedRow[],
  mode: "insert" | "upsert",
  carriedByEarlierFiles: Set<string>,
): Promise<void> {
  const target = entity.database;
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let maxNamingSeq = 0;
  const namingPrefix = entity.naming?.prefix ?? "";
  const now = new Date();
  const batch: Record<string, unknown>[] = [];

  for (const row of rows) {
    const id = row.__seedId ?? String(row["_id"]);
    const idString = toIdString(id);

    const { __seedId: _omit, ...rowData } = row;
    void _omit;
    // Honor a seed row's declared docstatus (a demo transactional shipset seeds
    // docstatus:1). Fail loud on an out-of-range value rather than silently
    // coercing it to 0 (no-silent-fallbacks); default to 0 (draft) when unset.
    // Checked before the modes split, so an upsert never writes what an insert
    // would refuse.
    const declaredDocstatus = row["docstatus"];
    if (
      declaredDocstatus !== undefined &&
      !(typeof declaredDocstatus === "number" && [0, 1, 2].includes(declaredDocstatus))
    ) {
      throw new Error(
        `Seed row "${String(id)}" for ${entity.name} has an invalid docstatus ` +
          `${JSON.stringify(declaredDocstatus)} — must be 0, 1, or 2`,
      );
    }
    const docstatus = typeof declaredDocstatus === "number" ? declaredDocstatus : 0;

    // An existing row is skipped in insert mode (non-destructive) and, in upsert
    // mode, replaced only when the seed differs from what is stored. A native
    // ObjectId just minted for `system` naming never collides, so both are no-ops
    // there.
    const existing = await db.findOne(entity.name, idString, target);
    if (existing && mode === "insert") {
      if (!carriedByEarlierFiles.has(idString) || !seedWrote(existing)) {
        skipped++;
        continue;
      }
      // A later tier's row sets its fields on the row the seed still owns. The write is
      // pinned on the seed identity, so a person's save that lands after the read above
      // keeps its values.
      const changes = serializeRowForStorage(entity, rowData);
      carryRowIds(changes, existing);
      injectRowIds(changes);
      if (Object.entries(changes).every(([key, value]) => deepEqual(value, existing[key]))) {
        unchanged++;
        continue;
      }
      const written = await db.updateOne(
        entity.name,
        idString,
        { ...changes, modified_by: SEED_IDENTITY, modified: now },
        target,
        undefined,
        { owner: SEED_IDENTITY, modified_by: SEED_IDENTITY },
      );
      if (written) updated++;
      else skipped++;
      continue;
    }
    if (existing) {
      const replacement = serializeRowForStorage(entity, rowData);
      carryRowIds(replacement, existing);
      injectRowIds(replacement);
      // The seed row is the whole truth of the document; only what the seed cannot
      // know is carried forward: when it was created and by whom, and the ids of
      // its child rows. An unchanged seed writes nothing, so `modified` (which the
      // website's sitemap reports as lastModified) moves only when a page did.
      const candidate: Record<string, unknown> = {
        ...replacement,
        _id: existing._id,
        doctype: entity.name,
        docstatus,
        owner: existing.owner ?? SEED_IDENTITY,
        creation: existing.creation ?? now,
      };
      if (sameDocument(candidate, existing)) {
        unchanged++;
        continue;
      }
      // The written document carries no `_id`: replaceOne keeps the stored one, which
      // matters for an entity whose ids are ObjectIds (findOne hands them back as strings).
      const { _id: _compared, ...body } = candidate;
      void _compared;
      await db.upsertOne(entity.name, idString, { ...body, modified_by: SEED_IDENTITY, modified: now }, target);
      updated++;
      continue;
    }

    const serialized = serializeRowForStorage(entity, rowData);
    injectRowIds(serialized);
    batch.push({
      ...serialized,
      _id: id,
      doctype: entity.name,
      docstatus,
      owner: SEED_IDENTITY,
      modified_by: SEED_IDENTITY,
      creation: now,
      modified: now,
    });

    if (typeof id === "string" && namingPrefix && id.startsWith(namingPrefix)) {
      const numPart = parseInt(id.slice(namingPrefix.length), 10);
      if (!Number.isNaN(numPart) && numPart > maxNamingSeq) maxNamingSeq = numPart;
    }
  }

  const CHUNK = 1000;
  for (let i = 0; i < batch.length; i += CHUNK) {
    const chunk = batch.slice(i, i + CHUNK);
    try {
      await db.insertMany(entity.name, chunk, target);
      inserted += chunk.length;
    } catch (e) {
      const bwe = e as {
        writeErrors?: Array<{ code?: number }>;
        result?: { insertedCount?: number };
      };
      const writeErrors = bwe.writeErrors ?? [];
      if (writeErrors.length === 0 || !writeErrors.every((w) => w.code === 11000)) throw e;
      const ok = bwe.result?.insertedCount ?? 0;
      inserted += ok;
      skipped += chunk.length - ok;
      log.warn(
        { entity: entity.name, db: target, collided: chunk.length - ok },
        "seed: rows already present by a unique index — skipped",
      );
    }
  }

  // Advance the naming sequence past seeded IDs so future inserts don't collide.
  // Monotonic ($max): a non-destructive re-seed must never REWIND a live counter
  // that runtime inserts already pushed higher (else it re-hands used ids).
  if (maxNamingSeq > 0) {
    await db.setSequenceFloor(entity.name, "naming_seq", maxNamingSeq, target);
  }

  log.info({ entity: entity.name, mode, inserted, updated, unchanged, skipped }, "seed-app-data");
}

/**
 * Keep the stored `_row_id` of every child row the seed carries again, matched by
 * position: a seed row knows no row ids, and a fresh id on every boot would break
 * every sub-row Link that points at the row.
 */
function carryRowIds(replacement: Record<string, unknown>, stored: Record<string, unknown>): void {
  for (const key of Object.keys(replacement)) {
    const rows = replacement[key];
    const storedRows = stored[key];
    if (!Array.isArray(rows) || !Array.isArray(storedRows)) continue;
    rows.forEach((row, i) => {
      const storedRow = storedRows[i];
      if (!row || typeof row !== "object" || !storedRow || typeof storedRow !== "object") return;
      const storedId = (storedRow as Record<string, unknown>)[ROW_ID_FIELD];
      if (typeof storedId === "string" && storedId) (row as Record<string, unknown>)[ROW_ID_FIELD] = storedId;
    });
  }
}

/**
 * Whether the stored document already says what the seed says: everything but the
 * modification stamp is compared, so a boot with an unchanged seed writes nothing.
 * A document this loader wrote carries exactly the seed's fields plus the stamps.
 */
function sameDocument(candidate: Record<string, unknown>, stored: Record<string, unknown>): boolean {
  const { modified: _modified, modified_by: _modifiedBy, ...rest } = stored;
  void _modified;
  void _modifiedBy;
  return deepEqual(candidate, rest);
}
