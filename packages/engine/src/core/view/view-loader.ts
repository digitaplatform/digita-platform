import { readdir, readFile } from "fs/promises";
import { join } from "path";
import type { ViewDefinition } from "@digitaplatform/shared";
import { DIGITA } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";
import { env } from "../config/env.js";
import { normalizeIdFilterValue } from "../document/id-codec.js";
import { createLogger } from "../logging/logger.js";
import { validateViewDefinition } from "./view-validator.js";
import type { ViewRegistry } from "./view-registry.js";

const log = createLogger("view-loader");

export interface ViewSeedSummary {
  loaded: number;
  skipped: number;
  /** Orphan view rows found this pass — backed by no current file and not
   * admin-overridden. Reported for visibility regardless of whether they
   * were actually deleted (see `pruned`). */
  orphans_detected: number;
  /** Rows actually deleted because their backing file was removed/renamed
   * (see `pruneOrphanViews`). Equals `orphans_detected` when
   * `PRUNE_ORPHAN_VIEWS=true`; 0 otherwise — detected but left in place. */
  pruned: number;
}

/**
 * Load views from `<appDir>/views/**.view.json` files and seed them into
 * the `views` collection. Views with `overridden=true` in mongo are
 * NOT re-seeded (admin UI modifications win) unless `force` includes their
 * id or "*".
 *
 * The file-loaded definition is also cached on the registry so drift can
 * be detected when DB rows are loaded later.
 *
 * After every file is processed, `pruneOrphanViews` finds any VIEW row
 * whose `_id` is backed by no current file and isn't admin-overridden — the
 * seed loop above only ever inserts/updates, so without this step a
 * renamed or deleted view file would leave its old DB row (and stale
 * definition) resolving forever. Deleting those rows is destructive and
 * irreversible at boot time, so it only happens when `PRUNE_ORPHAN_VIEWS`
 * is enabled (default off, mirroring `PRUNE_ORPHAN_INDEXES` /
 * `PRUNE_ORPHAN_COLLECTIONS`); otherwise they're logged for visibility and
 * left in place — a momentarily misconfigured or partially mounted
 * `APPS_DIRS` at boot must never silently delete a real app's views.
 */
export async function seedViewsFromFiles(
  db: MongoDBService,
  appDirs: string[],
  registry?: ViewRegistry,
  force: Set<string> = new Set(),
): Promise<ViewSeedSummary> {
  let loaded = 0;
  let skipped = 0;
  // Every `_id` found in a current `.view.json` file, regardless of whether
  // it went on to pass validation. Backs the orphan prune below: a file that
  // still exists (even if currently invalid) must never have its DB row
  // pruned — pruning only targets ids with NO current file at all.
  const currentFileIds = new Set<string>();

  for (const appDir of appDirs) {
    const viewsDir = join(appDir, "views");
    const files = await safeReaddirRecursive(viewsDir);
    for (const file of files) {
      if (!file.endsWith(".view.json")) continue;
      try {
        const raw = await readFile(file, "utf-8");
        const view = JSON.parse(raw) as ViewDefinition;
        if (typeof view?._id === "string" && view._id) currentFileIds.add(view._id);

        const errs = validateViewDefinition(view);
        if (errs.length) {
          for (const e of errs) {
            log.warn({ file, error: e.message }, "skipping view: validation failed");
          }
          skipped++;
          continue;
        }

        registry?.cacheFileVersion(view);

        const existingRow = (await db.findOne(DIGITA.COLLECTIONS.VIEW, view._id, DIGITA.DATABASES.CORE)) as Record<
          string,
          unknown
        > | null;
        if (
          existingRow &&
          existingRow["overridden"] === true &&
          !force.has(view._id) &&
          !force.has("*")
        ) {
          log.debug({ id: view._id }, "skipping view seed — admin-overridden");
          skipped++;
          continue;
        }
        const now = new Date();
        const payload = {
          ...view,
          enabled: view.enabled ?? true,
          overridden: false,
          modified: now,
          modified_by: "system",
          owner: "system",
          creation: existingRow?.["creation"] ?? now,
          docstatus: 0,
        };
        if (existingRow) {
          await db.updateOne(DIGITA.COLLECTIONS.VIEW, view._id, payload, DIGITA.DATABASES.CORE);
        } else {
          await db.insertOne(
            DIGITA.COLLECTIONS.VIEW,
            { ...payload, _id: view._id },
            DIGITA.DATABASES.CORE,
          );
        }
        loaded++;
      } catch (err) {
        log.error({ file, err }, "failed to seed view");
        skipped++;
      }
    }
  }

  const { detected, pruned } = await pruneOrphanViews(db, currentFileIds);
  log.info(
    { loaded, skipped, orphans_detected: detected.length, pruned: pruned.length },
    "view seeding complete",
  );
  return { loaded, skipped, orphans_detected: detected.length, pruned: pruned.length };
}

/**
 * Find VIEW rows that are backed by NEITHER a current file (a `_id` seen
 * during this seed pass) NOR the admin-override flag, and — only when
 * `PRUNE_ORPHAN_VIEWS` is enabled — delete them. This is what makes a
 * renamed/removed `<appDir>/views/**.view.json` file actually stop
 * resolving: without this, the old DB row from a prior boot lingers forever
 * because seeding itself is additive-only (insert/update, never delete).
 *
 * Admin-overridden rows (`overridden === true`) are the one legitimate case
 * of a DB-only view with no file — they are excluded on purpose. Anything
 * else with no matching current-file id is, by definition, a file-orphan.
 *
 * Detected orphans are ALWAYS logged (visibility), but only deleted when
 * the flag is on — see `PRUNE_ORPHAN_VIEWS` in env.ts for why this is
 * opt-in rather than unconditional.
 */
async function pruneOrphanViews(
  db: MongoDBService,
  currentFileIds: Set<string>,
): Promise<{ detected: string[]; pruned: string[] }> {
  const rows = (await db.find(DIGITA.COLLECTIONS.VIEW, {}, DIGITA.DATABASES.CORE)) as Array<
    Record<string, unknown>
  >;
  const orphanIds = rows
    .filter((row) => {
      const id = row["_id"];
      return typeof id === "string" && !currentFileIds.has(id) && row["overridden"] !== true;
    })
    .map((row) => row["_id"] as string);

  if (orphanIds.length === 0) return { detected: [], pruned: [] };

  if (!env.PRUNE_ORPHAN_VIEWS) {
    log.warn(
      { ids: orphanIds },
      "orphaned view rows detected — backing file removed or renamed (set PRUNE_ORPHAN_VIEWS=true to prune)",
    );
    return { detected: orphanIds, pruned: [] };
  }

  await db.deleteMany(
    DIGITA.COLLECTIONS.VIEW,
    { _id: normalizeIdFilterValue({ $in: orphanIds }) },
    DIGITA.DATABASES.CORE,
  );
  log.warn({ ids: orphanIds }, "pruned orphaned view rows — backing file removed or renamed");
  return { detected: orphanIds, pruned: orphanIds };
}

async function safeReaddirRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) out.push(...(await safeReaddirRecursive(full)));
      else out.push(full);
    }
  } catch {
    // dir absent — fine
  }
  return out;
}
