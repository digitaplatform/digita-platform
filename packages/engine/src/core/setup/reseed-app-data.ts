import { DIGITA } from "@digitaplatform/shared";
import { join } from "path";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { DomainDirectory } from "../database/app-db-discovery.js";
import type { TranslationService } from "../i18n/translation-service.js";
import { NamingService } from "../document/naming-service.js";
import { seedAppData, type UnresolvedSeedLink } from "./seed-app-data.js";
import { seedDataTranslations } from "./seed-data-translations.js";
import { createLogger } from "../logging/logger.js";
import { markReseedRunning } from "./reseed-lock.js";
import { env } from "../config/env.js";

const log = createLogger("reseed-app-data");

/**
 * Whether this engine may reseed its app data: only an app engine of a demo tenant, in production
 * and outside it. A website engine takes its pages from its site folder at boot, which a reseed
 * does not load, so a reseed would leave its site empty.
 */
export function isReseedAllowed(): boolean {
  return env.DEMO_TENANT && !env.SITE_ID;
}

export type ReseedMode = "template" | "demo";

export interface ReseedDeps {
  db: MongoDBService;
  registry: EntityRegistry;
  translationService: TranslationService;
  appDirs: string[];
  /**
   * Late-bound: domain directories are discovered during `startup()`
   * but the reseed route is registered earlier in `createApp()`. Resolved
   * at call time.
   */
  getDomainDirs(): DomainDirectory[];
}

export interface ReseedSummary {
  mode: ReseedMode;
  app_databases_wiped: string[];
  collections_wiped: number;
  rows_deleted: number;
  /** Seed Link values that name no business key of their target; each is stored as it stands. */
  unresolved_links: UnresolvedSeedLink[];
}

/** A reset refused while one in the other mode runs; the caller starts it once that one has ended. */
export class ReseedRunningError extends Error {
  constructor(
    readonly running: ReseedMode,
    readonly requested: ReseedMode,
  ) {
    super(`a reseed in mode ${running} is running; start the reseed in mode ${requested} once it has ended`);
    this.name = "ReseedRunningError";
  }
}

/** A reset whose seed failed after the wipe on every attempt, naming the last error. */
export class ReseedSeedFailedError extends Error {
  constructor(
    readonly attempts: number,
    readonly reason: string,
  ) {
    super(
      `the seed failed ${attempts} times after the app data was wiped; ` +
        `the app holds only the rows seeded before the failure: ${reason}`,
    );
    this.name = "ReseedSeedFailedError";
  }
}

/** The reseed this engine is running, which a second call joins. */
let running: { mode: ReseedMode; done: Promise<ReseedSummary> } | null = null;

/**
 * The destructive reseed of app data. Two modes:
 *
 *   "template" — wipes every app-db collection, re-runs reference JSON
 *     seeds (`<appDir>/<domain>/seeds/*.seed.json`), which include any
 *     mandatory is_single config the app declares.
 *
 *   "demo" — does the template mode AND also loads
 *     `<appDir>/<domain>/seeds-demo/*.seed.json`. Sets
 *     `Setting.is_first_run = false` at the end.
 *
 * Both modes are fully destructive. Reserved databases (`identity`,
 * `core`, `logs`) are preserved so the caller's session + UI chrome
 * survive. Every reseed starts from a clean slate — drift, half-applied
 * edits, stale orphan docs all vanish on each run.
 *
 * Demo seeds are pure JSON. Every demo doc carries its full payload
 * (incl. `_id`) and lands through the seed loader's insert mode. Any
 * transactional showcase (a submitted doc + its ledger / side-effect
 * chain) the operator wants beyond the seed data has to be clicked
 * through the UI like a real user.
 */
export async function reseedAppData(mode: ReseedMode, deps: ReseedDeps): Promise<ReseedSummary> {
  // One reset per app at a time: digita-jobs retries a chunk that runs past its limit while the
  // first attempt still runs, and a second wipe would empty what the first one is seeding. The
  // second call waits for the running one and answers its result.
  // ponytail: an in-process lock, one engine per app; a second replica would need a lock in the database.
  if (running) {
    if (running.mode !== mode) throw new ReseedRunningError(running.mode, mode);
    return running.done;
  }
  // Marked before the reset starts: its wipe begins before reseedOnce first yields.
  markReseedRunning(mode);
  const done = reseedOnce(mode, deps).finally(() => {
    running = null;
    markReseedRunning(undefined);
  });
  running = { mode, done };
  return done;
}

/** How often the seed runs after the wipe before the reset fails, naming the error. */
const SEED_ATTEMPTS = 2;

async function reseedOnce(mode: ReseedMode, deps: ReseedDeps): Promise<ReseedSummary> {
  const { db, registry, translationService, appDirs } = deps;
  const domainDirs = deps.getDomainDirs();

  // 1. Wipe every collection in every registered app database.
  const appDbs = db.listAppDatabases().map((d) => d.name);
  let collectionsWiped = 0;
  let rowsDeleted = 0;

  for (const entity of registry.getAll()) {
    if (!appDbs.includes(entity.database)) continue; // skip reserved DBs (users/admin/logs)
    try {
      const n = await db.deleteMany(entity.name, {}, entity.database);
      rowsDeleted += n;
      collectionsWiped++;
    } catch (e) {
      log.warn(
        { entity: entity.name, db: entity.database, err: (e as Error).message },
        "wipe step skipped (collection may not exist)",
      );
    }
  }

  // 2. Wipe sequences in every app database — naming counters
  //    must reset so reseeded rows reuse their original IDs.
  for (const dbName of appDbs) {
    try {
      await db.deleteMany("_sequences", {}, dbName);
    } catch {
      // collection may not exist on first reseed — fine
    }
  }

  // 3. Re-run reference JSON seeds and, in demo mode, the `seeds-demo` JSON files after
  // them. Both modes are pure-data: no scripted scenario builder, no per-doctype hooks.
  // Both tiers load in one call, as at boot: only then does a demo row of an `_id` the
  // reference tier carries (a single's demo company) update the reference row.
  const seedDirs = [
    ...appDirs.map((d) => join(d, "seeds")),
    ...domainDirs.map((d) => join(d.root, "seeds")),
  ];
  if (mode === "demo") {
    seedDirs.push(
      ...appDirs.map((d) => join(d, "seeds-demo")),
      ...domainDirs.map((d) => join(d.root, "seeds-demo")),
    );
  }
  // The wipe has run, so a seed that fails leaves the app with only the rows it seeded before
  // the failure: it runs again, and a second failure fails the reset, naming the error.
  let unresolved_links: UnresolvedSeedLink[] = [];
  for (let attempt = 1; ; attempt++) {
    try {
      ({ unresolved_links } = await seedAppData(db, registry, new NamingService(db), seedDirs));
      await seedDataTranslations(db, registry, translationService, seedDirs);
      break;
    } catch (e) {
      const message = (e as Error).message;
      if (attempt >= SEED_ATTEMPTS) {
        throw new ReseedSeedFailedError(attempt, message);
      }
      log.warn({ attempt, err: message }, "seed after the wipe failed; running it again");
    }
  }

  // is_first_run flag: demo mode flips it off (no further setup
  // expected); template mode keeps it on so the wizard's Done step
  // sees a fresh first-run state.
  // db.updateOne wraps these fields in $set itself — pass the plain fields,
  // not a $set document (else it double-wraps → "dollar-prefixed field $set
  // not allowed in replacement", MongoServerError code 52).
  await db.updateOne(
    DIGITA.COLLECTIONS.SETTING,
    "settings",
    {
      is_first_run: mode !== "demo",
      modified: new Date(),
      modified_by: "admin-reseed",
    },
    DIGITA.DATABASES.CORE,
  );

  return {
    mode,
    app_databases_wiped: appDbs,
    collections_wiped: collectionsWiped,
    rows_deleted: rowsDeleted,
    unresolved_links,
  };
}
