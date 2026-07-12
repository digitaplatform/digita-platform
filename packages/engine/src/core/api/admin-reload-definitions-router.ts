import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { DIGITA } from "@digitaplatform/shared";
import { join } from "path";
import { seedDataTranslations } from "../setup/seed-data-translations.js";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { ViewRegistry } from "../view/view-registry.js";
import type { TranslationService } from "../i18n/translation-service.js";
import type { RoleRegistry } from "../permissions/role-registry.js";
import type { DomainDirectory } from "../database/app-db-discovery.js";
import { seedRulesFromFiles, clearRuleCache } from "../rules/rule-loader.js";
import { seedViewsFromFiles } from "../view/view-loader.js";
import { successResponse } from "./response-model.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("admin-reload-definitions-router");

/**
 * Admin reload-definitions endpoint — fully refreshes metadata
 * (entity schemas, rules, views, translations) from on-disk JSON
 * sources, replacing the stored versions.
 *
 * Distinct from `/admin/reseed`:
 *   - `/admin/reseed` rewrites the DATA layer (entity rows in app DBs).
 *   - `/admin/reload-definitions` rewrites the METADATA layer (entity
 *     definitions, rules, views, translations stored in admin DB).
 *
 * Use case: after an operator edits an `.entity.json` file on disk
 * (or pulls in updated app code), trigger this endpoint to push the
 * changes into MongoDB without restarting the backend. Destructive —
 * any DB-side admin overrides on entities, rules, or views are lost.
 *
 * Out of scope (deliberate):
 *   - Hooks (`apps/<app>/<domain>/modules/**.ts`) — module cache reload
 *     across Node's ES-module loader is unreliable; restart the
 *     backend to pick up hook changes.
 *   - Data seeds — that's `/admin/reseed`.
 */
export interface AdminReloadDefinitionsDeps {
  db: MongoDBService;
  registry: EntityRegistry;
  viewRegistry: ViewRegistry;
  translationService: TranslationService;
  roleRegistry: RoleRegistry;
  /** App roots (e.g. `apps/erp`). Rules + views may live at this level. */
  appDirs: string[];
  /** Late-bound: platform internal entity dir + each `<appDir>/entities/` (flat layout). */
  getEntityDirs(): string[];
  /** Late-bound: locale source dirs — JSON message bundles per language. */
  getLocaleDirs(): string[];
  /** Late-bound: discovered during startup(). */
  getDomainDirs(): DomainDirectory[];
}

interface ReloadSummary {
  entities_reloaded: number;
  rules_dropped: number;
  rules_inserted: number;
  views_dropped: number;
  views_inserted: number;
  translations_dropped: number;
  translations_inserted: number;
  drift_after: number;
}

export function registerAdminReloadDefinitionsRoutes(
  app: FastifyInstance,
  prefix: string,
  deps: AdminReloadDefinitionsDeps,
): void {
  app.post(
    `${prefix}/admin/reload-definitions`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      if (!user || !user.roles?.includes("Administrator")) {
        return reply.code(403).send({ success: false, error: { code: "FORBIDDEN" } });
      }

      log.warn({ by: user.email }, "admin reload-definitions starting — destructive metadata refresh");
      const summary = await performReload(deps);
      log.info({ summary }, "admin reload-definitions finished");

      return reply.send(successResponse(summary));
    },
  );
}

async function performReload(deps: AdminReloadDefinitionsDeps): Promise<ReloadSummary> {
  const { db, registry, viewRegistry, translationService, roleRegistry } = deps;
  const domainDirs = deps.getDomainDirs();
  const entityDirs = deps.getEntityDirs();
  const localeDirs = deps.getLocaleDirs();

  // 1. Re-load entity definitions from disk into the registry. `loadAll`
  //    overwrites both the in-memory `entities` map and the file-snapshot
  //    `fileEntities` map for any name it encounters — that's exactly the
  //    refresh we want.
  for (const dir of entityDirs) {
    await registry.loadAll(dir);
  }
  for (const d of domainDirs) {
    await registry.loadAll(join(d.root, "entities"), { defaultDatabase: d.dbName });
  }

  // 2. Wipe the admin-side `entities` collection and re-write
  //    every loaded entity. This drops any DB-only overrides.
  await db.deleteMany(DIGITA.COLLECTIONS.ENTITY, {}, DIGITA.DATABASES.CORE);
  let entitiesReloaded = 0;
  for (const entity of registry.getAll()) {
    await db.insertOne(
      DIGITA.COLLECTIONS.ENTITY,
      {
        _id: entity.name,
        ...entity,
        owner: "system",
        modified_by: "system",
        creation: new Date(),
        modified: new Date(),
      },
      DIGITA.DATABASES.CORE,
    );
    entitiesReloaded++;
  }

  // 3. Refresh in-memory registry from the freshly written DB rows.
  //    Drift detection runs as a side-effect; should report zero
  //    immediately after this call.
  await registry.loadFromDb(db);

  // 4. Wipe + re-seed DocumentActionRule from `<appDir>/rules/*.rule.json`.
  const rulesBefore = await db.deleteMany(DIGITA.COLLECTIONS.RULE, {}, DIGITA.DATABASES.CORE);
  const ruleDirs = [...deps.appDirs, ...domainDirs.map((d) => d.root)];
  await seedRulesFromFiles(db, ruleDirs, registry);
  clearRuleCache();
  const rulesAfter = (await db.find(DIGITA.COLLECTIONS.RULE, {}, DIGITA.DATABASES.CORE)).length;

  // 5. Wipe + re-seed DocumentView from `<appDir>/views/**.view.json`.
  const viewsBefore = await db.deleteMany(DIGITA.COLLECTIONS.VIEW, {}, DIGITA.DATABASES.CORE);
  const viewDirs = [...deps.appDirs, ...domainDirs.map((d) => d.root)];
  await seedViewsFromFiles(db, viewDirs, viewRegistry, new Set(["*"]));
  await viewRegistry.loadFromDb(db);
  const viewsAfter = (await db.find(DIGITA.COLLECTIONS.VIEW, {}, DIGITA.DATABASES.CORE)).length;

  // 6. Wipe + re-seed system translations from JSON locale bundles. Only
  //    delete platform-internal entries (those with `source: "file"`); leave
  //    operator-edited entries alone — translations are heavily curated and
  //    overrides are valuable.
  const translationsBefore = await db.deleteMany(DIGITA.COLLECTIONS.TRANSLATION, { source: "file" }, DIGITA.DATABASES.CORE);
  for (const dir of localeDirs) {
    await translationService.seedFromFiles(dir);
  }
  // Re-seed co-located per-document DATA translations (seeds/*.translations.json).
  // The delete above already dropped the prior file-sourced rows (incl. data),
  // so this re-applies updated files; admin overrides (source != "file") survive.
  const dataTransDirs = [
    ...deps.appDirs.map((d) => join(d, "seeds")),
    ...domainDirs.map((d) => join(d.root, "seeds")),
  ];
  await seedDataTranslations(db, registry, translationService, dataTransDirs);
  const translationsAfter = (await db.find(
    DIGITA.COLLECTIONS.TRANSLATION,
    { filters: [{ source: "file" }] },
    DIGITA.DATABASES.CORE,
  )).length;

  // 7. Reload role registry — it caches Role rows in memory and entity
  //    permission validation references those names. After a definitions
  //    refresh, the names list might have changed.
  await roleRegistry.load();

  return {
    entities_reloaded: entitiesReloaded,
    rules_dropped: rulesBefore,
    rules_inserted: rulesAfter,
    views_dropped: viewsBefore,
    views_inserted: viewsAfter,
    translations_dropped: translationsBefore,
    translations_inserted: translationsAfter,
    drift_after: registry.getDriftSnapshots().length,
  };
}
