import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { PendingSetupRecord } from "../setup/setup-state.js";
import { requireAdministrator } from "../auth/require-admin.js";
import { evaluateExpression } from "../expression/expression-evaluator.js";
import {
  findEnabledDemoDataDefinition,
  findEnabledDemoDataKind,
  isLoaded,
  listChangedRecords,
  listUnseededRecords,
  readDemoDataStamps,
  type RecordCount,
} from "../setup/demo-data.js";
import { listDemoValues } from "../setup/demo-values.js";
import {
  findLastFailure,
  findRunningOperation,
  listSeedDirs,
  listSettingsEntities,
  type ReseedDeps,
} from "../setup/reseed-app-data.js";
import { env } from "../config/env.js";
import { successResponse } from "./response-model.js";

export interface DemoDataRouteDeps {
  reseed: ReseedDeps;
  listPendingSetupRecords(): Promise<PendingSetupRecord[]>;
}

/** A count with the label the app shows for its entity. */
const labelled = (registry: EntityRegistry, counts: RecordCount[]) =>
  counts.map(({ entity, count }) => ({ entity, label: registry.get(entity).label ?? entity, count }));

/**
 * `GET /demo-data`, for the Administrator: the state of the app's demo data and what its page shows
 * before an operation. The counts of created and changed records are given only while the demo
 * data is loaded, that is after a load the engine stamped: before the seed stamped its rows, every
 * demo row would count as created.
 */
export function registerDemoDataRoutes(app: FastifyInstance, prefix: string, deps: DemoDataRouteDeps): void {
  app.get(`${prefix}/demo-data`, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdministrator(request, reply)) return;
    const kind = findEnabledDemoDataKind();
    const definition = findEnabledDemoDataDefinition();
    if (!kind || !definition) return reply.code(404).send({ success: false, error: { code: "NOT_FOUND" } });
    const { db, registry } = deps.reseed;
    const stamps = await readDemoDataStamps(db);
    const loaded = isLoaded(stamps);
    const operations = (definition.actions ?? [])
      .filter((a) => !a.show_if || evaluateExpression(a.show_if, { doc: stamps as Record<string, unknown> }))
      .map((a) => a.action);
    const unseeded = await listUnseededRecords(db, registry);
    const changed = loaded ? await listChangedRecords(db, registry) : [];
    const settings = listSettingsEntities(deps.reseed);
    const { referenceDirs, demoDirs } = listSeedDirs(deps.reseed);
    const restored = kind === "tenant" && loaded ? await listDemoValues(db, settings, referenceDirs, demoDirs) : [];
    return reply.send(
      successResponse({
        kind,
        app_name: env.APP_NAME,
        loaded,
        loaded_at: stamps.loaded_at ?? null,
        loaded_by: stamps.loaded_by ?? null,
        removed_at: stamps.removed_at ?? null,
        removed_by: stamps.removed_by ?? null,
        operations,
        running: findRunningOperation() ?? null,
        last_failure: findLastFailure() ?? null,
        setup_complete: (await deps.listPendingSetupRecords()).length === 0,
        records_without_seed: labelled(registry, unseeded),
        changes: loaded ? { created: labelled(registry, unseeded), changed: labelled(registry, changed) } : null,
        fields_restored_by_remove: restored.map(({ entity, field }) => ({
          entity,
          field,
          label: registry.get(entity).fields.find((f) => f.fieldname === field)?.label ?? field,
        })),
      }),
    );
  });
}
