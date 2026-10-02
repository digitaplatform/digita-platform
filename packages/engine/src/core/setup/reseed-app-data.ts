import { join } from "path";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { DomainDirectory } from "../database/app-db-discovery.js";
import type { TranslationService } from "../i18n/translation-service.js";
import { NamingService } from "../document/naming-service.js";
import type { EntityDefinition } from "@digitaplatform/shared";
import type { StoragePort } from "../storage/storage-port.js";
import { DEMO_SEED_DIR, seedAppData, type UnresolvedSeedLink } from "./seed-app-data.js";
import { listDemoValues, restoreReferenceValues } from "./demo-values.js";
import { deleteWipedRecordLeftovers } from "./wipe-leftovers.js";
import { seedDataTranslations } from "./seed-data-translations.js";
import { createLogger } from "../logging/logger.js";
import { listWritesUnderWay, markReseedRunning, writesEnded } from "./reseed-lock.js";

const log = createLogger("reseed-app-data");

/** What an Administrator does with an app's demo data: load it, load it afresh, or take it out. */
export type DemoDataOperation = "load" | "reset" | "remove";

/** One run of the reseed: which operation, which tiers it seeds, and what its wipe keeps. */
export interface ReseedRequest {
  operation: DemoDataOperation;
  /** Seeds `seeds-demo/` after `seeds/`. */
  demoTier: boolean;
  /**
   * Keeps the customer's own configuration through the wipe: the settings records, every
   * `is_single` of an app database. A remove also sets each of their fields that still holds the
   * demo tier's value back to the reference tier's.
   */
  keepConfiguration: boolean;
}

export interface ReseedDeps {
  db: MongoDBService;
  registry: EntityRegistry;
  translationService: TranslationService;
  storage: StoragePort;
  appDirs: string[];
  /**
   * Late-bound: domain directories are discovered during `startup()`, after the demo data's
   * handlers are bound. Resolved at call time.
   */
  getDomainDirs(): DomainDirectory[];
}

export interface ReseedSummary {
  operation: DemoDataOperation;
  demo_tier: boolean;
  app_databases_wiped: string[];
  collections_wiped: number;
  rows_deleted: number;
  /** The settings records the wipe kept. */
  configuration_kept: string[];
  /** The settings fields a remove set back from the demo tier's value to the reference tier's. */
  fields_restored: { entity: string; field: string }[];
  /** Seed Link values that name no business key of their target; each is stored as it stands. */
  unresolved_links: UnresolvedSeedLink[];
}

/** An operation refused while another one runs; the caller starts it once that one has ended. */
export class ReseedRunningError extends Error {
  constructor(
    readonly running: DemoDataOperation,
    readonly requested: DemoDataOperation,
  ) {
    super(`the demo data operation ${running} is running; start ${requested} once it has ended`);
    this.name = "ReseedRunningError";
  }
}

/** An operation whose seed failed on every attempt, naming the last error. */
export class ReseedSeedFailedError extends Error {
  constructor(
    readonly attempts: number,
    readonly reason: string,
  ) {
    super(`the seed failed ${attempts} times; the app holds only the rows seeded before the failure: ${reason}`);
    this.name = "ReseedSeedFailedError";
  }
}

/** An operation that gave up before it began, because writes that began before it did not end in time. */
export class ReseedWritesRunningError extends Error {
  constructor(
    readonly seconds: number,
    readonly writes: string[],
  ) {
    super(`the operation waited ${seconds} s for writes that had not ended, and changed nothing: ${writes.join(", ")}`);
    this.name = "ReseedWritesRunningError";
  }
}

/** How long an operation waits for the writes under way before it gives up, so a write that never ends cannot lock the app. */
const WRITES_WAIT_MS = 60_000;

/** Resolves once the writes under way have ended, or rejects naming them after `WRITES_WAIT_MS`. */
async function writesEndedInTime(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ReseedWritesRunningError(WRITES_WAIT_MS / 1000, listWritesUnderWay())), WRITES_WAIT_MS);
  });
  try {
    await Promise.race([writesEnded(), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The operation this engine is running, which a second call of the same operation joins. */
let running: { operation: DemoDataOperation; done: Promise<ReseedSummary> } | null = null;
/** Why the last operation failed, since the engine started; cleared by one that succeeds. */
let lastFailure: string | undefined;

/** The operation this engine is running, if any. */
export function findRunningOperation(): DemoDataOperation | undefined {
  return running?.operation;
}

/** Why the last operation since the engine started failed, if it did. */
export function findLastFailure(): string | undefined {
  return lastFailure;
}

/**
 * Runs one demo data operation on the app databases of this engine. `reset` and `remove` wipe
 * every collection of every app database, apart from what `keepConfiguration` keeps, and with it
 * what the other databases hold of each wiped record and the naming counters; `load` wipes
 * nothing. Then the seed tiers load in insert mode, as at boot.
 *
 * Every write to an app database is refused while an operation runs, a load included: a record
 * created during a load could take an id a demo row carries, and the demo rows that link that id
 * would then point at it.
 */
export async function reseedAppData(request: ReseedRequest, deps: ReseedDeps): Promise<ReseedSummary> {
  // One operation per app at a time: digita-jobs retries a chunk that runs past its limit while the
  // first attempt still runs, and a second wipe would empty what the first one is seeding. The
  // second call of the same operation waits for the running one and answers its result.
  // ponytail: an in-process lock, one engine per app; a second replica would need a lock in the database.
  if (running) {
    if (running.operation !== request.operation) throw new ReseedRunningError(running.operation, request.operation);
    return running.done;
  }
  // Marked first, so every write that begins from now on is refused; the wipe waits for the writes
  // that began before, so none of them lands after it, and gives up after a bound, wiping nothing.
  markReseedRunning(request.operation);
  const done = writesEndedInTime()
    .then(() => reseedOnce(request, deps))
    .then(
      (summary) => {
        lastFailure = undefined;
        return summary;
      },
      (err: unknown) => {
        lastFailure = (err as Error).message;
        throw err;
      },
    )
    .finally(() => {
      running = null;
      markReseedRunning(undefined);
    });
  running = { operation: request.operation, done };
  return done;
}

/** How often the seed runs after the wipe before the operation fails, naming the error. */
const SEED_ATTEMPTS = 2;

/** The settings records of the app databases: the customer's own configuration a wipe can keep. */
export function listSettingsEntities(deps: Pick<ReseedDeps, "db" | "registry">): EntityDefinition[] {
  const appDbs = deps.db.listAppDatabases().map((d) => d.name);
  return deps.registry.getAll().filter((e) => e.is_single && appDbs.includes(e.database));
}

/** The folders of the reference tier and of the demo tier, of every app dir and domain. */
export function listSeedDirs(deps: ReseedDeps): { referenceDirs: string[]; demoDirs: string[] } {
  const roots = [...deps.appDirs, ...deps.getDomainDirs().map((d) => d.root)];
  return { referenceDirs: roots.map((d) => join(d, "seeds")), demoDirs: roots.map((d) => join(d, DEMO_SEED_DIR)) };
}

async function reseedOnce(request: ReseedRequest, deps: ReseedDeps): Promise<ReseedSummary> {
  const { db, registry, translationService } = deps;
  const { referenceDirs, demoDirs } = listSeedDirs(deps);
  const appDbs = db.listAppDatabases().map((d) => d.name);
  const kept = request.keepConfiguration ? listSettingsEntities(deps) : [];
  const summary: ReseedSummary = {
    operation: request.operation,
    demo_tier: request.demoTier,
    app_databases_wiped: [],
    collections_wiped: 0,
    rows_deleted: 0,
    configuration_kept: kept.map((e) => e.name),
    fields_restored: [],
    unresolved_links: [],
  };

  if (request.operation !== "load") {
    summary.app_databases_wiped = appDbs;
    const wiped: string[] = [];
    for (const entity of registry.getAll()) {
      if (!appDbs.includes(entity.database) || kept.includes(entity)) continue;
      try {
        summary.rows_deleted += await db.deleteMany(entity.name, {}, entity.database);
        summary.collections_wiped++;
        wiped.push(entity.name);
      } catch (e) {
        log.warn({ entity: entity.name, db: entity.database, err: (e as Error).message }, "wipe step skipped (collection may not exist)");
      }
    }
    await deleteWipedRecordLeftovers(db, deps.storage, wiped);
    // The naming counters start again, so the seeded rows take their ids again.
    for (const dbName of appDbs) {
      try {
        await db.deleteMany("_sequences", {}, dbName);
      } catch {
        // the collection does not exist before the first numbered record
      }
    }
    if (request.operation === "remove" && kept.length > 0) {
      const demoValues = await listDemoValues(db, kept, referenceDirs, demoDirs);
      await restoreReferenceValues(db, kept, demoValues);
      summary.fields_restored = demoValues.map(({ entity, field }) => ({ entity, field }));
    }
  }

  // Both tiers load in one call, as at boot: only then does a demo row of an `_id` the reference
  // tier carries (a single's demo company) update the reference row.
  const seedDirs = request.demoTier ? [...referenceDirs, ...demoDirs] : referenceDirs;
  // After a wipe, a seed that fails leaves the app with only the rows it seeded before the
  // failure: it runs again, and a second failure fails the operation, naming the error.
  for (let attempt = 1; ; attempt++) {
    try {
      ({ unresolved_links: summary.unresolved_links } = await seedAppData(db, registry, new NamingService(db), seedDirs));
      await seedDataTranslations(db, registry, translationService, seedDirs);
      break;
    } catch (e) {
      const message = (e as Error).message;
      if (attempt >= SEED_ATTEMPTS) throw new ReseedSeedFailedError(attempt, message);
      log.warn({ attempt, err: message }, "seed after the wipe failed; running it again");
    }
  }
  return summary;
}
