import { readdir, readFile } from "fs/promises";
import { join, extname } from "path";
import type { EntityDefinition, FieldDefinition, FieldType, FreezeSpec } from "@digitaplatform/shared";
import { DIGITA } from "@digitaplatform/shared";
import { LAYOUT_FIELD_TYPES } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";
import { createLogger } from "../logging/logger.js";
import { isValidStoragePath, STORAGE_PATH_RULE } from "../storage/storage-path.js";

const log = createLogger("entity-registry");

/**
 * Thrown by {@link EntityRegistry.get} for an unregistered doctype. Carries the
 * requested name plus the closest registered match so the API layer can render
 * a self-diagnosing 404 ("Unknown document type \"userMenu\" — did you mean
 * \"UserMenu\"?") instead of a bare, undebuggable message. `isCasing` is true
 * when the only difference is letter-case (the overwhelmingly common cause).
 */
export class UnknownDoctypeError extends Error {
  constructor(
    readonly doctype: string,
    readonly suggestion: string | null,
    readonly isCasing: boolean,
  ) {
    super(`Entity "${doctype}" not found in registry`);
    this.name = "UnknownDoctypeError";
  }
}

/** Levenshtein distance (inputs are short doctype names, so the naive DP is fine). */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * Build a self-diagnosing error for an unknown doctype: prefer a
 * case-insensitive hit (a casing mismatch — the usual culprit), else the
 * nearest registered name within a small edit distance, else no suggestion.
 */
function unknownDoctypeError(name: string, allNames: string[]): UnknownDoctypeError {
  const ciHit = allNames.find((n) => n.toLowerCase() === name.toLowerCase());
  if (ciHit) return new UnknownDoctypeError(name, ciHit, true);
  const lower = name.toLowerCase();
  let best: string | null = null;
  let bestDist = Infinity;
  for (const n of allNames) {
    const d = editDistance(lower, n.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      best = n;
    }
  }
  const threshold = Math.max(2, Math.ceil(name.length / 3));
  return new UnknownDoctypeError(name, bestDist <= threshold ? best : null, false);
}

export interface SchemaDriftEntry {
  entity: string;
  drift: string[];
}

export class EntityRegistry {
  private entities: Map<string, EntityDefinition> = new Map();
  /**
   * Snapshot of the file-loaded entity definition kept separately from the
   * runtime `entities` map (which is overwritten by `loadFromDb`). Lets
   * `detectDrift` and `reseedFromFile` compare against / fall back to the
   * version on disk after the DB has been read in.
   */
  private fileEntities: Map<string, EntityDefinition> = new Map();
  /** Absolute file path each entity name was last loaded from — so a redefinition
   *  from a DIFFERENT file can be surfaced (an app overriding a core entity is
   *  intentional; an accidental collision is not — both become visible). */
  private entitySources: Map<string, string> = new Map();
  /**
   * Snapshot of drift detected during the most recent `loadFromDb` call.
   * Exposed via `getDriftSnapshots()` for the admin schema-drift viewer.
   */
  private driftSnapshots: Map<string, string[]> = new Map();

  /**
   * Load all .entity.json files from a directory tree.
   *
   * `defaultDatabase` — when set, every entity loaded from this directory
   * has its `database` field forced to this value. Used by the per-app-dir
   * domain-database scanner: entities under `<appdir>/master/entities/`
   * always belong to the `<appname>_master` database, so individual JSON
   * files don't need to repeat the routing.
   */
  async loadAll(entitiesDir: string, options: { defaultDatabase?: string } = {}): Promise<void> {
    const startTime = Date.now();
    this.registerSystemEntities();
    await this.scanDirectory(entitiesDir, options.defaultDatabase);
    log.info(
      {
        count: this.entities.size,
        duration_ms: Date.now() - startTime,
        dir: entitiesDir,
        defaultDatabase: options.defaultDatabase,
      },
      "Entity definitions loaded",
    );
  }

  /**
   * Register synthetic entries for system-managed meta-collections that are
   * not file-defined but must be addressable by Link fields.
   *
   * Currently only `entities` — the meta-collection holding every loaded
   * entity definition. Permission.allow_entity is a Link to it so the
   * platform can validate at insert that the referenced doctype exists.
   */
  private registerSystemEntities(): void {
    if (this.entities.has(DIGITA.COLLECTIONS.ENTITY)) return;
    const meta: EntityDefinition = {
      name: DIGITA.COLLECTIONS.ENTITY,
      module: "core",
      database: DIGITA.DATABASES.CORE,
      label: "Entity",
      label_plural: "Entities",
      title_field: "label",
      naming: { strategy: "user_set" },
      fields: [
        { fieldname: "name", fieldtype: "Data", label: "Name", required: true, unique: true },
        { fieldname: "label", fieldtype: "Data", label: "Label" },
        { fieldname: "module", fieldtype: "Data", label: "Module" },
        { fieldname: "database", fieldtype: "Data", label: "Database" },
      ],
      permissions: [
        { role: "Administrator", level: 0, select: 1, read: 1 },
        { role: "System User", level: 0, select: 1, read: 1 },
      ],
    } as unknown as EntityDefinition;
    this.entities.set(DIGITA.COLLECTIONS.ENTITY, meta);
  }

  private async scanDirectory(dir: string, defaultDatabase?: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // Optional probe: an app/domain dir legitimately ships no entities (e.g. the
      // flat `<app>/entities/` path for a domain-split app). debug, not warn —
      // warn is reserved for actual misconfiguration. A genuinely empty registry
      // surfaces loudly downstream (schema migration / route registration).
      log.debug({ dir }, "Entity directory absent (skipped)");
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.scanDirectory(fullPath, defaultDatabase);
      } else if (entry.isFile() && entry.name.endsWith(".entity.json")) {
        await this.loadEntityFile(fullPath, defaultDatabase);
      }
    }
  }

  private async loadEntityFile(filePath: string, defaultDatabase?: string): Promise<void> {
    try {
      const content = await readFile(filePath, "utf-8");
      const entity: EntityDefinition = JSON.parse(content);

      if (defaultDatabase) {
        if (entity.database && entity.database !== defaultDatabase) {
          log.warn(
            {
              file: filePath,
              entity: entity.name,
              declared: entity.database,
              expected: defaultDatabase,
            },
            "Entity declares a database that doesn't match its containing folder — overriding",
          );
        }
        entity.database = defaultDatabase;
      }

      this.applyDefaults(entity);
      this.expandFlattenDirectives(entity);
      entity.fields.sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0));
      this.validateSnapshotManifest(entity);
      this.validateTimeSeriesConfig(entity);
      this.validatePeriodCheckConfig(entity);
      this.validateAllowOnSubmit(entity);

      // Surface a name redefined from a DIFFERENT file (silent last-write-wins
      // before). Intentional app-over-core overrides are a documented feature, so
      // this WARNS (doesn't fail) — but an accidental collision is now visible.
      const priorSource = this.entitySources.get(entity.name);
      if (priorSource && priorSource !== filePath) {
        log.warn(
          { entity: entity.name, previous: priorSource, current: filePath },
          "Entity name redefined by a later file — the later definition wins " +
            "(expected for intentional app overrides of core entities; an accidental collision also surfaces here)",
        );
      }
      this.entitySources.set(entity.name, filePath);

      this.entities.set(entity.name, entity);
      // Keep an immutable file-loaded snapshot separately so we can compare
      // / reseed against it later, even after `loadFromDb` has overwritten
      // `entities` with the DB version.
      this.fileEntities.set(entity.name, JSON.parse(JSON.stringify(entity)));
      log.debug(
        { entity: entity.name, file: filePath, database: entity.database },
        "Entity loaded",
      );
    } catch (err) {
      // A malformed .entity.json used to be log-and-continue (silently disabling
      // that entity). Fail loud like the platform's other boot lints so a broken
      // definition can't ship unnoticed.
      log.error({ file: filePath, err }, "Failed to load entity definition — aborting boot");
      throw err instanceof Error
        ? new Error(`Malformed entity definition ${filePath}: ${err.message}`, { cause: err })
        : err;
    }
  }

  /**
   * Expand each Link field's `freeze.flatten[]` directive into auto-generated
   * `FieldDefinition`s appended to `entity.fields` (or `field.child_fields`
   * for table children). Idempotent: if a field with the target name is
   * already declared by the entity author, no duplicate is added — the
   * hand-declaration takes precedence (with a warn if its shape differs
   * from the flatten spec, e.g. missing read_only).
   *
   * Also collects auto-index requests (`flatten.indexed === true`) and
   * appends them to `entity.indexes[]` so the schema-migrator picks them
   * up — the entity author declares the index alongside the flatten
   * spec rather than maintaining a parallel index list.
   */
  private expandFlattenDirectives(entity: EntityDefinition): void {
    const expand = (
      hostFields: FieldDefinition[],
      ownerLabel: string,
    ): void => {
      const declared = new Set(hostFields.map((f) => f.fieldname));
      for (const link of [...hostFields]) {
        if (link.fieldtype !== "Link") continue;
        const f = link.freeze;
        if (!f || typeof f !== "object" || Array.isArray(f)) continue;
        for (const spec of f.flatten ?? []) {
          if (declared.has(spec.as)) {
            log.debug(
              { entity: ownerLabel, link: link.fieldname, as: spec.as },
              "flatten target already declared — keeping hand-declared field",
            );
            continue;
          }
          const generated: FieldDefinition = {
            fieldname: spec.as,
            fieldtype: spec.fieldtype ?? "Data",
            label: spec.label ?? spec.as,
            read_only: true,
          };
          if (spec.in_list_view) generated.in_list_view = true;
          if (spec.in_standard_filter) generated.in_standard_filter = true;
          if (spec.bold) generated.bold = true;
          if (spec.description) generated.description = spec.description;
          if (spec.fetch_from) {
            generated.fetch_from =
              spec.fetch_from === true
                ? `${link.fieldname}.${spec.from}`
                : spec.fetch_from;
            if (spec.fetch_if_empty) generated.fetch_if_empty = true;
          }
          // Generated fields go to the end; entity-load sorts by idx so
          // the natural ordering by source link remains.
          generated.idx = (link.idx ?? 0) + 0.5;
          hostFields.push(generated);
          declared.add(spec.as);

          if (spec.indexed) {
            entity.indexes ??= [];
            const idxName = `idx_${spec.as}`;
            if (!entity.indexes.some((i) => i.name === idxName)) {
              entity.indexes.push({ name: idxName, fields: [spec.as] });
            }
          }
        }
      }
    };

    expand(entity.fields, entity.name);
    for (const field of entity.fields) {
      if (field.fieldtype === "Table" && field.child_fields) {
        expand(field.child_fields, `${entity.name}.${field.fieldname}`);
      }
    }
  }

  /**
   * Validate `entity.snapshot[]` and per-Table `field.snapshot[]` manifests.
   * Mirrors the platform's "warn, don't fail" philosophy — a malformed manifest
   * disables itself but the entity continues to load. Invalid manifests are
   * stripped so the resolver never sees a broken declaration.
   *
   * The `_snapshot` suffix is reserved for the snapshot-resolver's freeze
   * payload (`<fieldname>_snapshot` JSON sub-object). Manifest target keys
   * matching that pattern, or hand-declared fields matching it where the
   * base field carries an active `freeze`, get the manifest entry stripped
   * — otherwise a future submit would silently overwrite the value.
   */
  private validateSnapshotManifest(entity: EntityDefinition): void {
    const fieldByName = new Map(entity.fields.map((f) => [f.fieldname, f]));

    const isFreezeOn = (field: FieldDefinition): boolean => {
      if (field.freeze === true) return true;
      if (Array.isArray(field.freeze) && field.freeze.length > 0) return true;
      return false;
    };

    // A-2 lint: refuse hand-declared fields named `<base>_snapshot` when
    // `<base>` carries an active freeze. The snapshot-resolver writes to
    // exactly that key on submit, so the hand-declared default would be
    // silently overwritten. Strips the field rather than failing boot.
    const stripSnapshotShadows = (
      fields: FieldDefinition[],
      ctx: string,
    ): void => {
      const freezeBases = new Set(
        fields.filter(isFreezeOn).map((f) => f.fieldname),
      );
      for (let i = fields.length - 1; i >= 0; i--) {
        const f = fields[i];
        if (!f) continue;
        if (!f.fieldname.endsWith("_snapshot")) continue;
        const base = f.fieldname.slice(0, -"_snapshot".length);
        if (freezeBases.has(base)) {
          log.warn(
            { entity: entity.name, ctx, field: f.fieldname, base },
            "field name shadows freeze-output — declaration removed " +
              "(the snapshot-resolver writes to <base>_snapshot on submit; " +
              "a hand-declared field of the same name would be silently overwritten)",
          );
          fields.splice(i, 1);
        }
      }
    };

    const checkOne = (
      manifest: import("@digitaplatform/shared").SnapshotManifest,
      hostFields: Map<string, FieldDefinition>,
      ctx: string,
    ): boolean => {
      const fromField = hostFields.get(manifest.from);
      if (!fromField) {
        log.warn(
          { entity: entity.name, ctx, from: manifest.from },
          "snapshot.from references unknown field — manifest disabled",
        );
        return false;
      }
      if (fromField.fieldtype !== "Link") {
        log.warn(
          { entity: entity.name, ctx, from: manifest.from, type: fromField.fieldtype },
          "snapshot.from is not a Link — manifest disabled",
        );
        return false;
      }
      let ok = true;
      for (const [target, source] of Object.entries(manifest.fields)) {
        // A-2 lint: the `_snapshot` suffix is reserved for freeze output
        // on any Link field. A manifest writing into that namespace would
        // collide with the resolver's later freeze pass (manifests run
        // first, freeze runs second — manifest value gets overwritten).
        if (target.endsWith("_snapshot")) {
          const base = target.slice(0, -"_snapshot".length);
          const baseField = hostFields.get(base);
          if (baseField && isFreezeOn(baseField)) {
            log.warn(
              { entity: entity.name, ctx, target, base },
              "snapshot target collides with freeze output — entry disabled " +
                "(the resolver writes <base>_snapshot from freeze on submit, " +
                "overwriting any manifest value)",
            );
            ok = false;
            continue;
          }
        }

        const tf = hostFields.get(target);
        if (!tf) {
          log.warn(
            { entity: entity.name, ctx, target },
            "snapshot writes to undeclared field — manifest disabled",
          );
          ok = false;
          continue;
        }
        if (!tf.read_only) {
          log.warn(
            { entity: entity.name, ctx, target },
            "snapshot target field must have read_only=true — entry disabled",
          );
          ok = false;
        }
        if (tf.fetch_from) {
          log.warn(
            { entity: entity.name, ctx, target },
            "snapshot target field also declares fetch_from — entry disabled",
          );
          ok = false;
        }
        if (typeof source !== "string" || !source) {
          log.warn(
            { entity: entity.name, ctx, target },
            "snapshot source path empty — entry disabled",
          );
          ok = false;
        }
      }
      return ok;
    };

    // Strip shadow fields BEFORE validating manifests so the manifest's
    // hostFields map reflects the post-strip shape.
    stripSnapshotShadows(entity.fields, "top");
    fieldByName.clear();
    for (const f of entity.fields) fieldByName.set(f.fieldname, f);

    if (entity.snapshot?.length) {
      entity.snapshot = entity.snapshot.filter((m) => checkOne(m, fieldByName, "top"));
      if (entity.snapshot.length === 0) delete entity.snapshot;
    }

    for (const field of entity.fields) {
      if (field.fieldtype !== "Table" || !field.child_fields) continue;
      stripSnapshotShadows(field.child_fields, `table:${field.fieldname}`);
      if (!field.snapshot?.length) continue;
      const childMap = new Map(field.child_fields.map((cf) => [cf.fieldname, cf]));
      field.snapshot = field.snapshot.filter((m) =>
        checkOne(m, childMap, `table:${field.fieldname}`),
      );
      if (field.snapshot.length === 0) delete field.snapshot;
    }
  }

  /**
   * Boot lint for `allow_on_submit`. The flag opens a field to post-submit
   * mutation via `updateSubmitted`; it is illegal on fields that are frozen,
   * snapshot/freeze output, system-stamped, set-once, or file attachments.
   * Mirrors `validateSnapshotManifest`: WARN + STRIP the flag (never fail
   * boot). Also warns (no strip) when a doc_status-1 → doc_status-1
   * transition's `side_effects.set` touches a non-band field — that would
   * fail at runtime inside `updateSubmitted`.
   */
  private validateAllowOnSubmit(entity: EntityDefinition): void {
    const SYSTEM = new Set([
      "docstatus",
      "owner",
      "creation",
      "modified",
      "modified_by",
      "_id",
      "doctype",
      "amended_from",
      "idx",
    ]);
    const FILE_TYPES = new Set<FieldType>(["Attach", "AttachImage"]);

    const isFreezeActive = (f: FieldDefinition): boolean => {
      if (f.freeze === true) return true;
      if (Array.isArray(f.freeze)) return f.freeze.length > 0;
      if (f.freeze && typeof f.freeze === "object") return true;
      return false;
    };

    // Names the freeze/snapshot resolver writes to on submit — a flag here
    // would be overwritten (or fight the freeze) after submit.
    const frozenOutputs = (fields: FieldDefinition[]): Set<string> => {
      const out = new Set<string>();
      for (const f of fields) {
        if (f.freeze && typeof f.freeze === "object" && !Array.isArray(f.freeze)) {
          for (const spec of (f.freeze as FreezeSpec).flatten ?? []) {
            if (spec.as) out.add(spec.as);
          }
        }
        if (isFreezeActive(f)) out.add(`${f.fieldname}_snapshot`);
      }
      return out;
    };

    const check = (fields: FieldDefinition[], ctx: string, snapshotTargets: Set<string>): void => {
      const outputs = frozenOutputs(fields);
      for (const f of fields) {
        if (f.allow_on_submit !== true) continue;
        let reason: string | null = null;
        if (SYSTEM.has(f.fieldname) || f.fieldname.startsWith("_")) reason = "system field";
        else if (f.set_only_once) reason = "conflicts with set_only_once";
        else if (isFreezeActive(f)) reason = "field has an active freeze";
        else if (outputs.has(f.fieldname)) reason = "freeze/snapshot output field";
        else if (snapshotTargets.has(f.fieldname)) reason = "snapshot-manifest target";
        else if (FILE_TYPES.has(f.fieldtype))
          reason = "Attach/AttachImage (refcount cleanup not wired on the post-submit path)";
        else if (LAYOUT_FIELD_TYPES.includes(f.fieldtype)) reason = "layout fieldtype";
        if (reason) {
          log.warn(
            { entity: entity.name, ctx, field: f.fieldname, reason },
            "allow_on_submit stripped — " + reason,
          );
          delete f.allow_on_submit;
        }
      }
    };

    const topSnapshotTargets = new Set<string>();
    for (const m of entity.snapshot ?? []) {
      for (const target of Object.keys(m.fields)) topSnapshotTargets.add(target);
    }
    check(entity.fields, "top", topSnapshotTargets);

    for (const field of entity.fields) {
      if (field.fieldtype !== "Table" || !field.child_fields) continue;
      const childSnapshotTargets = new Set<string>();
      for (const m of field.snapshot ?? []) {
        for (const target of Object.keys(m.fields)) childSnapshotTargets.add(target);
      }
      check(field.child_fields, `table:${field.fieldname}`, childSnapshotTargets);
    }

    // Advisory: a doc_status-1 → doc_status-1 transition whose side_effects.set
    // targets a non-band field would be rejected at runtime by updateSubmitted.
    if (entity.is_submittable && entity.transitions?.length && entity.states?.length) {
      const bandTop = new Set(
        entity.fields.filter((f) => f.allow_on_submit === true).map((f) => f.fieldname),
      );
      const workflowField = entity.workflow_field ?? "status";
      const docStatusOf = (v: string | undefined): number | undefined =>
        entity.states!.find((s) => s.value === v)?.doc_status;
      const anyDocStatusOne = entity.states.some((s) => s.doc_status === 1);
      for (const t of entity.transitions) {
        const se = t.side_effects?.set;
        if (!se) continue;
        const fromOne = t.from === "*" ? anyDocStatusOne : docStatusOf(t.from) === 1;
        const toOne = docStatusOf(t.to) === 1;
        if (!fromOne || !toOne) continue;
        for (const key of Object.keys(se)) {
          if (key === workflowField) continue;
          if (!bandTop.has(key)) {
            log.warn(
              { entity: entity.name, transition: `${t.from}->${t.to}`, field: key },
              "doc_status-1 transition side_effects.set targets a non-allow_on_submit field — " +
                "updateSubmitted would reject it at runtime",
            );
          }
        }
      }
    }
  }

  /**
   * Validate `entity.time_series` config against the entity's other flags.
   * Mongo time-series collections are append-optimised: docs are insert-only
   * apart from limited modifications to the `meta_field`. Combinations that
   * imply mutability (`is_submittable`, `track_changes`) or period-close
   * enforcement (which only makes sense when updates can be rejected on the
   * basis of a period flag flipped post-insert) are forbidden.
   *
   * "Warn, don't fail" — invalid `time_series` is stripped; the entity loads
   * as a regular collection so boot completes.
   */
  private validateTimeSeriesConfig(entity: EntityDefinition): void {
    const ts = entity.time_series;
    if (!ts) return;
    const reasons: string[] = [];

    if (entity.is_submittable) reasons.push("is_submittable=true incompatible");
    if (entity.track_changes) reasons.push("track_changes=true incompatible");
    if (!ts.time_field) {
      reasons.push("time_field required");
    } else {
      const tf = entity.fields.find((f) => f.fieldname === ts.time_field);
      if (!tf) {
        reasons.push(`time_field "${ts.time_field}" not declared`);
      } else if (tf.fieldtype !== "Date" && tf.fieldtype !== "Datetime") {
        reasons.push(`time_field must be Date/Datetime (got ${tf.fieldtype})`);
      }
    }
    if (ts.meta_field) {
      const mf = entity.fields.find((f) => f.fieldname === ts.meta_field);
      if (!mf) {
        reasons.push(`meta_field "${ts.meta_field}" not declared`);
      } else if (mf.fieldtype !== "Data" && mf.fieldtype !== "Link") {
        reasons.push(`meta_field must be Data or Link (got ${mf.fieldtype})`);
      }
    }
    if (reasons.length) {
      log.warn(
        { entity: entity.name, reasons },
        "time_series config invalid — disabled for this entity",
      );
      delete entity.time_series;
    }
  }

  /**
   * Validate `entity.period_check`. Strips the config and emits a warning
   * when:
   *   the date_field doesn't exist or isn't Date/Datetime
   *   the period_field (if set) isn't a Link
   *   block_on entries are unknown phases
   *   the entity also declares time_series (the two are mutually exclusive
   *     time-series collections never update so period-close on update has
   *     no surface)
   *
   * Note: the period_entity may not be loaded yet at validation time (entity
   * load order is filesystem-dependent), so we don't fail on its absence.
   * The validator at runtime warns and skips when the period_entity isn't
   * registered.
   */
  private validatePeriodCheckConfig(entity: EntityDefinition): void {
    const pc = entity.period_check;
    if (!pc) return;
    const reasons: string[] = [];

    if (entity.time_series) reasons.push("incompatible with time_series");
    if (!pc.date_field) {
      reasons.push("date_field required");
    } else {
      const df = entity.fields.find((f) => f.fieldname === pc.date_field);
      if (!df) {
        reasons.push(`date_field "${pc.date_field}" not declared`);
      } else if (df.fieldtype !== "Date" && df.fieldtype !== "Datetime") {
        reasons.push(`date_field must be Date/Datetime (got ${df.fieldtype})`);
      }
    }
    if (!pc.period_entity) reasons.push("period_entity required");
    if (pc.period_field) {
      const pf = entity.fields.find((f) => f.fieldname === pc.period_field);
      if (!pf) {
        reasons.push(`period_field "${pc.period_field}" not declared`);
      } else if (pf.fieldtype !== "Link") {
        reasons.push(`period_field must be Link (got ${pf.fieldtype})`);
      }
    }
    if (pc.block_on) {
      // "cancel" added in #23 so submitted docs in closed
      // accounting periods can't be silently rolled back.
      // "post_submit_update" gates updateSubmitted() patches independently
      // of "update" (settlement counters vs draft edits).
      const valid = new Set(["insert", "update", "submit", "cancel", "post_submit_update"]);
      const bad = pc.block_on.filter((p) => !valid.has(p));
      if (bad.length) reasons.push(`block_on contains unknown phases: ${bad.join(", ")}`);
    }
    if (reasons.length) {
      log.warn(
        { entity: entity.name, reasons },
        "period_check config invalid — disabled for this entity",
      );
      delete entity.period_check;
    }
  }

  private applyDefaults(entity: EntityDefinition): void {
    entity.is_submittable = entity.is_submittable ?? false;
    entity.is_child = entity.is_child ?? false;
    entity.is_single = entity.is_single ?? false;
    entity.is_virtual = entity.is_virtual ?? false;
    entity.is_log = entity.is_log ?? false;
    // Time-series collections are insert-only — versioning makes no sense.
    // Default `track_changes` accordingly so authors don't have to remember.
    if (entity.time_series) {
      entity.track_changes = entity.track_changes ?? false;
    } else {
      entity.track_changes = entity.track_changes ?? true;
    }
    entity.track_views = entity.track_views ?? false;
    entity.allow_import = entity.allow_import ?? false;
    entity.allow_export = entity.allow_export ?? true;
    entity.in_global_search = entity.in_global_search ?? false;
    entity.allow_quick_entry = entity.allow_quick_entry ?? false;
  }

  /**
   * Load entity definitions from MongoDB (`entities` collection).
   * Overwrites any in-memory definitions — DB is the runtime source of truth.
   *
   * Before overwriting, compares against the file-loaded definition and
   * logs a warning when fields have been added, removed, or retyped. This
   * surfaces schema drift (e.g. a production DB lagging behind file changes)
   * without blocking boot.
   */
  async loadFromDb(db: MongoDBService): Promise<void> {
    const startTime = Date.now();
    this.registerSystemEntities();
    const docs = await db.find(DIGITA.COLLECTIONS.ENTITY, {}, DIGITA.DATABASES.CORE);

    this.driftSnapshots.clear();
    let driftCount = 0;
    for (const doc of docs) {
      const entity = doc as unknown as EntityDefinition;
      this.applyDefaults(entity);
      entity.fields.sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0));
      // Compare the DB-loaded entity against the file-loaded snapshot held
      // in `fileEntities` (immutable since boot's loadAll). The runtime
      // `entities` map has already been overwritten on prior iterations so
      // it can't be used as the comparison baseline.
      const fileVersion = this.fileEntities.get(entity.name);
      if (fileVersion) {
        const drift = this.detectDrift(fileVersion, entity);
        if (drift.length) {
          driftCount++;
          this.driftSnapshots.set(entity.name, drift);
          log.warn({ entity: entity.name, drift }, "Schema drift between file and DB definition");
        }
      }
      this.entities.set(entity.name, entity);
    }

    log.info(
      { count: docs.length, drift: driftCount, duration_ms: Date.now() - startTime },
      "Entity definitions loaded from database",
    );
  }

  /** Return the file-loaded snapshot for a given entity, or undefined when
   *  the entity has no file source (e.g. created at runtime via the meta API). */
  getFileEntity(name: string): EntityDefinition | undefined {
    return this.fileEntities.get(name);
  }

  /**
   * Reseed the DB definition for one entity from its file-loaded snapshot.
   * Overwrites any admin edits stored in the `entities` collection.
   * After the write, refreshes the in-memory `entities` map and re-runs
   * drift detection so the schema-drift viewer reflects the new state.
   *
   * Throws when the entity has no file source — runtime-only entities can't
   * be "reseeded from file".
   */
  async reseedFromFile(db: MongoDBService, name: string): Promise<void> {
    const file = this.fileEntities.get(name);
    if (!file) {
      throw new Error(`Cannot reseed "${name}": no file-loaded definition`);
    }
    // Overwrite the DB row. Use the entity name as `_id` to match the seed
    // convention used by `seed-entity-definitions.ts`.
    const dbDoc: Record<string, unknown> = JSON.parse(JSON.stringify(file));
    dbDoc["_id"] = name;
    await db.deleteOne(DIGITA.COLLECTIONS.ENTITY, name, DIGITA.DATABASES.CORE);
    await db.insertOne(DIGITA.COLLECTIONS.ENTITY, dbDoc, DIGITA.DATABASES.CORE);
    // Reload from DB to refresh the in-memory entity + re-evaluate drift.
    await this.loadFromDb(db);
  }

  /**
   * Return drift detected at the most recent `loadFromDb` call. Each entry
   * lists the human-readable differences between the entity's file-loaded
   * definition and the DB-loaded one. Empty when no drift was observed.
   */
  getDriftSnapshots(): SchemaDriftEntry[] {
    return Array.from(this.driftSnapshots.entries()).map(([entity, drift]) => ({
      entity,
      drift,
    }));
  }

  /**
   * Return a human-readable list of field-level differences between the
   * file-loaded (`file`) and the DB-loaded (`db`) entity definitions.
   * Drift items are advisory — they don't throw.
   */
  private detectDrift(file: EntityDefinition, db: EntityDefinition): string[] {
    const out: string[] = [];
    // Top-level props that drive hard runtime behavior are diffed too —
    // storage_path gates every upload (and the boot lint), so a DB row
    // diverging from the file must surface in the drift viewer instead of
    // producing unexplained 400s.
    if ((file.storage_path ?? null) !== (db.storage_path ?? null)) {
      out.push(
        `storage_path differs: file=${file.storage_path ?? "(none)"} db=${db.storage_path ?? "(none)"}`,
      );
    }
    const byName = <T extends { fieldname: string }>(arr: T[]) =>
      new Map(arr.map((f) => [f.fieldname, f]));
    const fileFields = byName(file.fields ?? []);
    const dbFields = byName(db.fields ?? []);
    for (const [name, ff] of fileFields) {
      const df = dbFields.get(name);
      if (!df) {
        out.push(`field "${name}" missing in DB`);
        continue;
      }
      if (df.fieldtype !== ff.fieldtype) {
        out.push(`field "${name}" type differs: file=${ff.fieldtype} db=${df.fieldtype}`);
      }
    }
    for (const name of dbFields.keys()) {
      if (!fileFields.has(name)) out.push(`field "${name}" only in DB (not in file)`);
    }
    return out;
  }

  /**
   * Register an entity definition programmatically (e.g., for testing).
   */
  register(entity: EntityDefinition): void {
    this.entities.set(entity.name, entity);
  }

  // ─── Query Methods ─────────────────────────────────────

  get(name: string): EntityDefinition {
    const entity = this.entities.get(name);
    if (!entity) {
      throw unknownDoctypeError(name, this.getAllNames());
    }
    return entity;
  }

  has(name: string): boolean {
    return this.entities.has(name);
  }

  getAll(): EntityDefinition[] {
    return Array.from(this.entities.values());
  }

  getAllNames(): string[] {
    return Array.from(this.entities.keys());
  }

  // ─── Snapshot Coverage Audit ───────────────────────────

  /**
   * Walk every `is_submittable: true` entity and report every Link
   * (top-level OR child) that lacks a freeze directive AND is not
   * covered by an entity-level `snapshot[]` manifest with a matching
   * `from` entry.
   *
   * Output is informational — the boot-time wiring decides whether to
   * downgrade these to warnings or upgrade them to a hard fail. The
   * audit is non-destructive and runs in O(entities × fields). See
   * `docs/guides/10-foreign-keys.md` for the master-side `snapshot_fields`
   * declaration each Link target is expected to carry.
   */
  auditFreezeCoverage(): Array<{
    entity: string;
    field: string;
    target?: string;
  }> {
    const gaps: Array<{ entity: string; field: string; target?: string }> = [];

    for (const entity of this.entities.values()) {
      if (!entity.is_submittable) continue;

      const manifestFroms = new Set<string>(
        (entity.snapshot ?? []).map((m) => m.from),
      );

      const checkField = (
        field: FieldDefinition,
        ownerLabel: string,
        manifestSet: Set<string>,
      ): void => {
        if (field.fieldtype !== "Link") return;
        const hasFieldFreeze = field.freeze !== undefined; // true | false | string[]
        const hasManifest = manifestSet.has(field.fieldname);
        if (hasFieldFreeze || hasManifest) return;
        const entry: { entity: string; field: string; target?: string } = {
          entity: ownerLabel,
          field: field.fieldname,
        };
        if (field.target) entry.target = field.target;
        gaps.push(entry);
      };

      // Top-level fields.
      for (const field of entity.fields) {
        if (field.fieldtype === "Table" && field.child_fields) {
          // Per-Table manifest entries match `from` against the child fieldname.
          const childManifestFroms = new Set<string>(
            (field.snapshot ?? []).map((m) => m.from),
          );
          for (const childField of field.child_fields) {
            checkField(
              childField,
              `${entity.name}.${field.fieldname}`,
              childManifestFroms,
            );
          }
        } else {
          checkField(field, entity.name, manifestFroms);
        }
      }
    }

    return gaps;
  }

  /**
   * Scope-enforcement audit — `permission.scope` narrows row visibility, but
   * enforcement is gated by PERMISSION_SCOPE_ENABLED (inert until principals
   * carry the scope claim, see env.ts). A scope declared while enforcement is
   * off silently grants the role UNSCOPED access, so boot names every such
   * declaration. Advisory (warning), never fatal: deployed apps already
   * declare scopes and must keep booting.
   */
  auditUnenforcedScopes(scopeEnforcementEnabled: boolean): Array<{
    entity: string;
    role: string;
    field: string;
    user_field: string;
  }> {
    if (scopeEnforcementEnabled) return [];
    const out: Array<{ entity: string; role: string; field: string; user_field: string }> = [];
    for (const entity of this.entities.values()) {
      for (const perm of entity.permissions ?? []) {
        if (perm.scope) {
          out.push({
            entity: entity.name,
            role: perm.role,
            field: perm.scope.field,
            user_field: perm.scope.user_field,
          });
        }
      }
    }
    return out;
  }

  // ─── Attach Storage-Path Audit ─────────────────────────

  /**
   * Walk EVERY entity and report storage_path problems for the entity-scoped
   * upload scheme (key = `<storage_path>/<uuid><ext>`, NO bucket-root
   * fallback by design):
   *
   *   - an entity declaring Attach/AttachImage fields (top-level or inside
   *     Table child_fields) WITHOUT a `storage_path`, or
   *   - any declared `storage_path` that fails the format rule
   *     (lowercase [a-z0-9_-] segments, at most one "/" nesting, no
   *     leading/trailing slash, no "..").
   *
   * Entities that merely store file METADATA (e.g. the engine-internal
   * File entity — Data fields only, no Attach fieldtypes) are exempt.
   *
   * Output is consumed by the boot wiring in app.ts, which upgrades any
   * offender to a hard boot failure — the no-fallback rule must be caught
   * before the first upload, not at request time.
   */
  auditAttachStoragePaths(): Array<{ entity: string; problem: string }> {
    const offenders: Array<{ entity: string; problem: string }> = [];

    const isAttach = (f: FieldDefinition): boolean =>
      f.fieldtype === "Attach" || f.fieldtype === "AttachImage";

    for (const entity of this.entities.values()) {
      const attachFields: string[] = [];
      for (const field of entity.fields ?? []) {
        if (isAttach(field)) attachFields.push(field.fieldname);
        if (field.fieldtype === "Table" && field.child_fields) {
          for (const child of field.child_fields) {
            if (isAttach(child)) attachFields.push(`${field.fieldname}.${child.fieldname}`);
          }
        }
      }

      const sp = entity.storage_path;
      if (sp !== undefined && !isValidStoragePath(sp)) {
        offenders.push({
          entity: entity.name,
          problem: `storage_path "${sp}" is invalid — expected ${STORAGE_PATH_RULE}`,
        });
        continue;
      }
      if (attachFields.length > 0 && !sp) {
        offenders.push({
          entity: entity.name,
          problem:
            `declares Attach/AttachImage field(s) [${attachFields.join(", ")}] ` +
            `but no storage_path — every upload must land in an entity-scoped ` +
            `folder (there is no default folder and no bucket-root fallback)`,
        });
      }
    }

    return offenders;
  }

  // ─── Field Query Methods ───────────────────────────────

  getFields(name: string): FieldDefinition[] {
    return this.get(name).fields;
  }

  getStoredFields(name: string): FieldDefinition[] {
    return this.get(name).fields.filter((f) => !LAYOUT_FIELD_TYPES.includes(f.fieldtype));
  }

  getLinkFields(name: string): FieldDefinition[] {
    return this.get(name).fields.filter((f) => f.fieldtype === "Link");
  }

  getTableFields(name: string): FieldDefinition[] {
    return this.get(name).fields.filter((f) => f.fieldtype === "Table");
  }

  getSearchFields(name: string): string[] {
    return this.get(name).search_fields ?? [];
  }

  getTranslatableFields(name: string): string[] {
    return this.get(name)
      .fields.filter((f) => f.translatable)
      .map((f) => f.fieldname);
  }

  getRequiredFields(name: string): FieldDefinition[] {
    return this.get(name).fields.filter(
      (f) => f.required && !LAYOUT_FIELD_TYPES.includes(f.fieldtype),
    );
  }

  getUniqueFields(name: string): FieldDefinition[] {
    return this.get(name).fields.filter(
      (f) => f.unique && !LAYOUT_FIELD_TYPES.includes(f.fieldtype),
    );
  }

  getField(entityName: string, fieldname: string): FieldDefinition | undefined {
    return this.get(entityName).fields.find((f) => f.fieldname === fieldname);
  }

  getTitleField(name: string): string {
    const entity = this.get(name);
    return entity.title_field ?? "_id";
  }

  /**
   * Get all Link fields across ALL entities that point to a given target entity.
   * Used for delete protection.
   *
   * `target_path?: string` — when set, the referencing Link points at a row
   * inside that Table on the target. Delete-protection callers use this to
   * scope queries (the Link value is composite `parent::row`, not just the
   * parent _id, so a naive `field === id` query won't find these references).
   */
  getIncomingLinks(
    targetEntity: string,
  ): Array<{ entity: string; fieldname: string; target_path?: string }> {
    const results: Array<{ entity: string; fieldname: string; target_path?: string }> = [];

    for (const entity of this.entities.values()) {
      for (const field of entity.fields) {
        if (field.fieldtype === "Link" && field.target === targetEntity) {
          const entry: { entity: string; fieldname: string; target_path?: string } = {
            entity: entity.name,
            fieldname: field.fieldname,
          };
          if (field.target_path) entry.target_path = field.target_path;
          results.push(entry);
        }
        // Also check inside child table fields
        if (field.fieldtype === "Table" && field.child_fields) {
          for (const childField of field.child_fields) {
            if (childField.fieldtype === "Link" && childField.target === targetEntity) {
              const entry: { entity: string; fieldname: string; target_path?: string } = {
                entity: entity.name,
                fieldname: `${field.fieldname}.${childField.fieldname}`,
              };
              if (childField.target_path) entry.target_path = childField.target_path;
              results.push(entry);
            }
          }
        }
      }
    }

    return results;
  }
}
