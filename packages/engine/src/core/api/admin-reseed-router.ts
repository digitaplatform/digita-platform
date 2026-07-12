import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { DIGITA } from "@digitaplatform/shared";
import { join } from "path";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { DomainDirectory } from "../database/app-db-discovery.js";
import type { TranslationService } from "../i18n/translation-service.js";
import { NamingService } from "../document/naming-service.js";
import { seedAppData } from "../setup/seed-app-data.js";
import { seedDataTranslations } from "../setup/seed-data-translations.js";
import { successResponse } from "./response-model.js";
import { createLogger } from "../logging/logger.js";
import { env } from "../config/env.js";

const log = createLogger("admin-reseed-router");

/**
 * Admin reseed endpoint — destructive bootstrap of app data via the setup
 * wizard. Two modes:
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
 * (incl. `_id`) and lands via a single `db.insertMany` per file. Any
 * transactional showcase (a submitted doc + its ledger / side-effect
 * chain) the operator wants beyond the seed data has to be clicked
 * through the UI like a real user.
 */
export interface AdminReseedDeps {
  db: MongoDBService;
  registry: EntityRegistry;
  translationService: TranslationService;
  appDirs: string[];
  /**
   * Late-bound: domain directories are discovered during `startup()`
   * but the route is registered earlier in `createApp()`. Resolved
   * at request time.
   */
  getDomainDirs(): DomainDirectory[];
}

interface ReseedBody {
  mode?: string;
}

interface ReseedSummary {
  mode: "template" | "demo";
  app_databases_wiped: string[];
  collections_wiped: number;
  rows_deleted: number;
}

export function registerAdminReseedRoutes(
  app: FastifyInstance,
  prefix: string,
  deps: AdminReseedDeps,
): void {
  app.post(
    `${prefix}/admin/reseed`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      if (!user || !user.roles?.includes("Administrator")) {
        return reply.code(403).send({ success: false, error: { code: "FORBIDDEN" } });
      }

      // Destructive — blocked in production unless explicitly enabled.
      if (env.NODE_ENV === "production" && !env.ALLOW_DESTRUCTIVE_RESEED) {
        return reply.code(403).send({
          success: false,
          error: { code: "RESEED_DISABLED", detail: "set ALLOW_DESTRUCTIVE_RESEED to enable in production" },
        });
      }

      const body = (request.body ?? {}) as ReseedBody;
      const mode = body.mode === "demo" ? "demo" : body.mode === "template" ? "template" : null;
      if (!mode) {
        return reply.code(400).send({
          success: false,
          error: { code: "INVALID_MODE", detail: "mode must be 'template' or 'demo'" },
        });
      }

      log.warn({ mode, by: user.email }, "admin reseed starting — destructive operation");

      const summary = await performReseed(mode, deps);

      log.info({ summary }, "admin reseed finished");
      return reply.send(successResponse(summary));
    },
  );
}

async function performReseed(
  mode: "template" | "demo",
  deps: AdminReseedDeps,
): Promise<ReseedSummary> {
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

  // 3. Re-run reference JSON seeds.
  const referenceDirs = [
    ...appDirs.map((d) => join(d, "seeds")),
    ...domainDirs.map((d) => join(d.root, "seeds")),
  ];
  await seedAppData(db, registry, new NamingService(db), referenceDirs);
  await seedDataTranslations(db, registry, translationService, referenceDirs);

  // 4. Demo mode: also load `seeds-demo` JSON files. Both modes are
  // pure-data: no scripted scenario builder, no per-doctype hooks.
  // Demo seeds carry every field they need (incl. _id) so a single
  // bulk-insert per file is the entire reseed.
  if (mode === "demo") {
    const demoDirs = [
      ...appDirs.map((d) => join(d, "seeds-demo")),
      ...domainDirs.map((d) => join(d.root, "seeds-demo")),
    ];
    await seedAppData(db, registry, new NamingService(db), demoDirs);
    await seedDataTranslations(db, registry, translationService, demoDirs);
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
  };
}
