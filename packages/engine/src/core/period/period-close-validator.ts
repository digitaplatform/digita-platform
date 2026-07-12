import type { ClientSession } from "mongodb";
import type { EntityDefinition, PeriodCheckConfig } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import { createLogger } from "../logging/logger.js";
import { PeriodCache } from "./period-cache.js";

const log = createLogger("period-close-validator");

/**
 * Phase that triggered the period check. The validator is called once
 * per phase from `DocumentService` and only enforces when the entity's
 * `period_check.block_on` includes the current phase.
 *
 * added `"cancel"` so submitted docs in closed periods
 * cannot be silently rolled back without an explicit period reopen.
 */
export type PeriodCheckPhase = "insert" | "update" | "submit" | "cancel" | "post_submit_update";

export class PeriodClosedError extends Error {
  constructor(
    public readonly entity: string,
    public readonly periodEntity: string,
    public readonly periodId: string | null,
    public readonly dateValue: Date | string | null,
    public readonly phase: PeriodCheckPhase,
  ) {
    super(`Period "${periodId ?? "<by-date>"}" on ${entity}.${phase} is closed (${periodEntity})`);
    this.name = "PeriodClosedError";
  }
}

export class NoMatchingPeriodError extends Error {
  constructor(
    public readonly entity: string,
    public readonly periodEntity: string,
    public readonly dateValue: Date | string,
  ) {
    super(`No ${periodEntity} period covers ${String(dateValue)} for ${entity}`);
    this.name = "NoMatchingPeriodError";
  }
}

/**
 * Thrown when MORE THAN ONE period covers a date — an overlapping fiscal calendar.
 * Resolving such a date to an arbitrary period is a period-close bypass, so fail
 * loud instead of silently picking the first match.
 */
export class AmbiguousPeriodError extends Error {
  constructor(
    public readonly entity: string,
    public readonly periodEntity: string,
    public readonly dateValue: Date | string,
    public readonly periodIds: string[],
  ) {
    super(
      `Multiple ${periodEntity} periods cover ${String(dateValue)} for ${entity}: ` +
        `${periodIds.join(", ")} (overlapping fiscal calendar)`,
    );
    this.name = "AmbiguousPeriodError";
  }
}

/**
 * thrown when a doc's `date_field` value falls OUTSIDE
 * the start_date..end_date window of the period it explicitly references
 * via `period_field`. By-date lookup never produces this error (the
 * lookup itself enforces the range); it only fires when an operator
 * pre-fills the period link by hand to a row that doesn't cover the
 * doc's date.
 */
export class DateOutsidePeriodError extends Error {
  constructor(
    public readonly entity: string,
    public readonly periodEntity: string,
    public readonly periodId: string,
    public readonly dateField: string,
    public readonly dateValue: Date | string,
    public readonly periodStart: Date | string,
    public readonly periodEnd: Date | string,
  ) {
    super(
      `${entity}.${dateField}=${String(dateValue)} falls outside ${periodEntity} "${periodId}" range (${String(periodStart)}..${String(periodEnd)})`,
    );
    this.name = "DateOutsidePeriodError";
  }
}

/**
 * Validates that the period containing a document's effective date is open.
 *
 * Strategy:
 *   If `period_field` is configured and the doc carries a value, fetch
 *     that period directly.
 *   Else, scan `period_entity` for a row whose `start_date <= date <= end_date`.
 *
 * Cascade: if the period entity itself declares a `period_check`, the
 * resolved period is rechecked against its parent (e.g. fiscalPeriod →
 * fiscalYear). Any closed ancestor short-circuits to closed.
 *
 * Defaults: when `block_on` is omitted, only `submit` is enforced. Drafts
 * stay editable inside closed periods so amendment workflows can adjust
 * docs even after a period is locked, then re-submit into a new period.
 */
export class PeriodCloseValidator {
  private cache = new PeriodCache();

  constructor(
    private registry: EntityRegistry,
    private db: MongoDBService,
  ) {}

  /** Test-only: clear the TTL cache. */
  clearCache(): void {
    this.cache.clear();
  }

  /** Test-only: cache size. */
  cacheSize(): number {
    return this.cache.size();
  }

  /**
   * Throws `PeriodClosedError` when the period covering the doc is closed
   * AND the current phase is in the entity's `block_on` list. Throws
   * `NoMatchingPeriodError` when by-date lookup finds no covering period
   * (loud failure — silent acceptance would mask misconfigured calendars).
   */
  async assertPeriodOpen(
    entity: EntityDefinition,
    data: Record<string, unknown>,
    phase: PeriodCheckPhase,
    session?: ClientSession,
  ): Promise<void> {
    const cfg = entity.period_check;
    if (!cfg) return;

    const blockOn: PeriodCheckPhase[] = cfg.block_on ?? ["submit"];
    if (!blockOn.includes(phase)) return;

    const period = await this.resolvePeriod(entity.name, cfg, data, session);
    if (!period) return; // resolvePeriod throws when nothing matches

    // when the doc explicitly references a period via
    // period_field, also assert the doc's date_field value falls inside
    // that period's start_date..end_date window. By-date lookup never
    // reaches this branch (the lookup itself enforces the range), so this
    // is purely a guard against operators hand-picking the wrong period.
    if (cfg.period_field && data[cfg.period_field]) {
      const dateRaw = data[cfg.date_field];
      if (dateRaw != null && dateRaw !== "") {
        const date = dateRaw instanceof Date ? dateRaw : new Date(String(dateRaw));
        if (!isNaN(date.getTime())) {
          const startRaw = period["start_date"];
          const endRaw = period["end_date"];
          const start = parseDate(startRaw);
          const end = parseDate(endRaw);
          // Compare at DATE granularity: `date` may be a Datetime carrying a
          // time-of-day component, while period start_date/end_date are
          // date-only. A raw timestamp comparison falsely rejects a value on
          // the period's last day (e.g. 2026-06-30T14:00 > 2026-06-30T00:00).
          // Normalize all three to YYYY-MM-DD (matches resolvePeriod above).
          const dateDay = date.toISOString().slice(0, 10);
          if (
            start &&
            end &&
            (dateDay < start.toISOString().slice(0, 10) ||
              dateDay > end.toISOString().slice(0, 10))
          ) {
            throw new DateOutsidePeriodError(
              entity.name,
              cfg.period_entity,
              String(period["_id"] ?? ""),
              cfg.date_field,
              date,
              start,
              end,
            );
          }
        }
      }
    }

    await this.assertOpenCascade(entity.name, cfg.period_entity, period, phase, session);
  }

  /**
   * Resolve the matching period row (or throw NoMatchingPeriodError when
   * by-date lookup fails). Returns null only when there is no date value
   * to look up at all.
   */
  private async resolvePeriod(
    entityName: string,
    cfg: PeriodCheckConfig,
    data: Record<string, unknown>,
    session?: ClientSession,
  ): Promise<Record<string, unknown> | null> {
    if (!this.registry.has(cfg.period_entity)) {
      log.warn(
        { entity: entityName, period_entity: cfg.period_entity },
        "period_check references unknown period entity — skipping",
      );
      return null;
    }
    const periodEntity = this.registry.get(cfg.period_entity);

    if (cfg.period_field) {
      const linkedId = data[cfg.period_field];
      if (typeof linkedId === "string" && linkedId) {
        const cached = this.cache.get(cfg.period_entity, linkedId);
        if (cached) return cached;
        const fresh = await this.db.findOne(
          cfg.period_entity,
          linkedId,
          periodEntity.database,
          session,
        );
        if (fresh) {
          this.cache.set(cfg.period_entity, linkedId, fresh as Record<string, unknown>);
          return fresh as Record<string, unknown>;
        }
        // Linked period is missing — fall through to date lookup if the
        // doc also has a date value, otherwise treat as no match.
      }
    }

    const dateRaw = data[cfg.date_field];
    if (dateRaw == null || dateRaw === "") return null;
    const date = dateRaw instanceof Date ? dateRaw : new Date(String(dateRaw));
    if (isNaN(date.getTime())) return null;

    // Date fields are persisted as ISO strings (see field-types.ts dateHandler)
    // query both as Date AND as the YYYY-MM-DD string to cover any
    // mixed-storage state. Mongo treats `{ $or: [...] }` as union; whichever
    // side matches wins. Without this dual query, period_check by date would
    // silently fail for any entity whose period stores `start_date`/`end_date`
    // as the canonical Date string.
    const dateStr = date.toISOString().slice(0, 10);
    const matches = await this.db.findManyByFilter(
      cfg.period_entity,
      {
        $or: [
          { start_date: { $lte: date }, end_date: { $gte: date } },
          { start_date: { $lte: dateStr }, end_date: { $gte: dateStr } },
        ],
      },
      periodEntity.database,
      session,
    );
    if (matches.length === 0) {
      throw new NoMatchingPeriodError(entityName, cfg.period_entity, date);
    }
    if (matches.length > 1) {
      throw new AmbiguousPeriodError(
        entityName,
        cfg.period_entity,
        date,
        matches.map((m) => String((m as Record<string, unknown>)["_id"])),
      );
    }
    const found = matches[0] as Record<string, unknown>;
    const id = String(found["_id"]);
    if (id) this.cache.set(cfg.period_entity, id, found);
    return found;
  }

  /**
   * Walk the period and any parent periods declared via the period
   * entity's own `period_check`. A closed flag anywhere in the chain
   * is a closed result.
   */
  private async assertOpenCascade(
    sourceEntity: string,
    periodEntity: string,
    period: Record<string, unknown>,
    phase: PeriodCheckPhase,
    session?: ClientSession,
    visited: Set<string> = new Set(),
  ): Promise<void> {
    const id = String(period["_id"] ?? "");
    if (id && visited.has(`${periodEntity}:${id}`)) return;
    if (id) visited.add(`${periodEntity}:${id}`);

    // Read the close-flag LIVE — never from the TTL cache. The cache absorbs the
    // expensive by-date resolution above, but a period closed within the cache
    // window would otherwise still read as open, letting a submit slip into a
    // just-closed period for up to the TTL. Re-read only this financial-control
    // flag (an indexed _id lookup) to close that bypass.
    let closed = period["is_closed"] === true;
    if (id && this.registry.has(periodEntity)) {
      const live = (await this.db.findOne(
        periodEntity,
        id,
        this.registry.get(periodEntity).database,
        session,
      )) as Record<string, unknown> | null;
      if (live) closed = live["is_closed"] === true;
    }
    if (closed) {
      throw new PeriodClosedError(
        sourceEntity,
        periodEntity,
        id || null,
        (period[periodEntity] as Date | string) ?? null,
        phase,
      );
    }

    if (!this.registry.has(periodEntity)) return;
    const def = this.registry.get(periodEntity);
    const parentCfg = def.period_check;
    if (!parentCfg) return;

    const parent = await this.resolvePeriod(periodEntity, parentCfg, period, session);
    if (!parent) return;
    await this.assertOpenCascade(
      periodEntity,
      parentCfg.period_entity,
      parent,
      phase,
      session,
      visited,
    );
  }
}

/** Coerce a stored date value (Date, ISO string, YYYY-MM-DD) to Date. */
function parseDate(raw: unknown): Date | null {
  if (raw == null) return null;
  if (raw instanceof Date) return Number.isFinite(raw.getTime()) ? raw : null;
  if (typeof raw === "string" && raw.length > 0) {
    const d = new Date(raw);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}
