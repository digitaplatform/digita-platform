import type { ViewDefinition } from "@digitaplatform/shared";
import { DIGITA } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("view-registry");

export class ViewRegistry {
  private views: Map<string, ViewDefinition> = new Map();
  private fileVersions: Map<string, ViewDefinition> = new Map();

  /**
   * Cache the file-loaded version. Called by `seedViewsFromFiles` so drift
   * can be diffed when DB rows are loaded later.
   */
  cacheFileVersion(def: ViewDefinition): void {
    this.fileVersions.set(def._id, def);
  }

  async loadFromDb(db: MongoDBService): Promise<void> {
    const startTime = Date.now();
    const docs = (await db.find(DIGITA.COLLECTIONS.VIEW, {}, DIGITA.DATABASES.CORE)) as Array<Record<string, unknown>>;

    let driftCount = 0;
    for (const doc of docs) {
      const view = doc as unknown as ViewDefinition;
      const fileVersion = this.fileVersions.get(view._id);
      if (fileVersion) {
        const drift = this.detectDrift(fileVersion, view);
        if (drift.length) {
          driftCount++;
          log.warn({ view: view._id, drift }, "view drift between file and DB");
        }
      }
      this.views.set(view._id, view);
    }
    log.info(
      { count: docs.length, drift: driftCount, duration_ms: Date.now() - startTime },
      "Views loaded from database",
    );
  }

  private detectDrift(file: ViewDefinition, db: ViewDefinition): string[] {
    const out: string[] = [];
    const fileSecs = new Map((file.sections ?? []).map((s) => [s.key, s]));
    const dbSecs = new Map((db.sections ?? []).map((s) => [s.key, s]));
    for (const [k, fs] of fileSecs) {
      const ds = dbSecs.get(k);
      if (!ds) {
        out.push(`section "${k}" missing in DB`);
        continue;
      }
      if (fs.kind !== ds.kind)
        out.push(`section "${k}" kind differs: file=${fs.kind} db=${ds.kind}`);
      if (fs.entity !== ds.entity)
        out.push(`section "${k}" entity differs: file=${fs.entity} db=${ds.entity}`);
    }
    for (const k of dbSecs.keys()) {
      if (!fileSecs.has(k)) out.push(`section "${k}" only in DB`);
    }
    return out;
  }

  /** Programmatic registration (used by tests). */
  register(def: ViewDefinition): void {
    this.views.set(def._id, def);
  }

  get(name: string): ViewDefinition {
    const v = this.views.get(name);
    if (!v) throw new Error(`View "${name}" not found in registry`);
    return v;
  }

  has(name: string): boolean {
    return this.views.has(name);
  }

  getAll(): ViewDefinition[] {
    return Array.from(this.views.values());
  }
}
