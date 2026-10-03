import type { EntityDefinition, DatabaseTarget } from "@digitaplatform/shared";
import { ObjectId, type ClientSession } from "mongodb";
import type { MongoDBService } from "../database/mongodb-service.js";
import { createLogger } from "../logging/logger.js";
import { EngineError } from "../errors/engine-error.js";
import { randomUUID } from "crypto";

const log = createLogger("naming-service");

/**
 * Thrown when a naming series expression references a `{####:<token>}`
 * partition field that is empty/missing on the document being named (e.g.
 * a referenced field that was never populated). Distinguishes this
 * user-fixable input problem from unexpected engine errors so the API can
 * respond 400 (naming the offending field) instead of a generic 500.
 */
export class NamingSeriesFieldEmptyError extends EngineError {
  declare readonly field: string;

  constructor(
    public readonly entity: string,
    field: string,
  ) {
    super("naming_field_required", { field }, 400, "NAMING_FIELD_REQUIRED", field);
  }
}

/** A naming configuration of an entity that lacks what its strategy needs: a fault of the app's author. */
const namingConfigInvalid = (entity: EntityDefinition) =>
  new EngineError("naming_config_invalid", { doctype: entity.name, strategy: String(entity.naming?.strategy) }, 500, "NAMING_CONFIG_INVALID");

/**
 * Bound on how many times the self-heal loop (see `resolveUniqueSequence`)
 * will advance the sequence looking for a free key. A real drift is at most
 * as large as the pre-existing document count for that series; anything
 * beyond this cap means something else is wrong (e.g. the naming expression
 * can never produce a free value), so we fail loudly instead of spinning.
 */
// H24: bounded well within a transaction's lifetime. Each skip is ~2 serial
// round-trips (existsByField + getNextSequence) inside the caller's insert
// transaction, so a very high cap let large counter drift (bulk import/restore)
// blow the transaction time limit and abort — rolling back every counter
// increment, so the next attempt restarted from the same drifted point and
// bricked inserts permanently. A small cap fails fast to an explicit resync
// (schema-migrator initializeSequence) instead of looping into a transaction abort.
const MAX_SEQUENCE_SKIP_ATTEMPTS = 2_000;

export class NamingService {
  constructor(private db: MongoDBService) {}

  /**
   * Generate the _id (business key) for a new document.
   */
  async generateId(
    entity: EntityDefinition,
    data: Record<string, unknown>,
    session?: ClientSession,
  ): Promise<string | ObjectId> {
    const naming = entity.naming;

    switch (naming.strategy) {
      case "system":
        // System-assigned native ObjectId (see docs/guides/id-concept.md): unique by
        // construction, never user-typed. The human-facing identifier lives in a
        // separate business_key field, not in _id.
        return new ObjectId();

      case "auto_increment": {
        const padLength = naming.pad_length ?? 5;
        const prefix = naming.prefix ?? "";
        const seqName = entity.name;
        const firstSeq = await this.db.getNextSequence(seqName, "naming_seq", entity.database, session);
        return this.resolveUniqueSequence(
          seqName,
          entity.database,
          session,
          entity.name,
          "_id",
          firstSeq,
          (seq) => `${prefix}${String(seq).padStart(padLength, "0")}`,
        );
      }

      case "uuid":
        return randomUUID();

      case "by_field": {
        const fieldName = naming.field;
        if (!fieldName) {
          throw namingConfigInvalid(entity);
        }
        const value = data[fieldName];
        if (!value) {
          throw new NamingSeriesFieldEmptyError(entity.name, fieldName);
        }
        return String(value);
      }

      case "expression": {
        const expr = naming.expression;
        if (!expr) {
          throw namingConfigInvalid(entity);
        }
        return await this.evaluateNamingExpression(
          entity.name,
          expr,
          data,
          entity.database,
          session,
        );
      }

      case "user_set": {
        const id = data["_id"];
        if (!id) {
          throw new EngineError("naming_name_required", { doctype: entity.name }, 400, "NAMING_NAME_REQUIRED", "_id");
        }
        return String(id);
      }

      default:
        throw namingConfigInvalid(entity);
    }
  }

  /**
   * Evaluate a business-key series expression (e.g. "DOC-{####:year_label}")
   * to produce a document's human number. Uses the same machinery and per-series
   * sequence keying as naming expressions, so a document that moved its number off
   * `_id` into a business_key field keeps numbering continuity.
   */
  async generateSeries(
    entity: EntityDefinition,
    expression: string,
    data: Record<string, unknown>,
    session?: ClientSession,
  ): Promise<string> {
    const keyField = typeof entity.business_key === "string" ? entity.business_key : "_id";
    return this.evaluateNamingExpression(
      entity.name,
      expression,
      data,
      entity.database,
      session,
      keyField,
    );
  }

  /**
   * Evaluate a naming expression like "DOC-{YYYY}-{MM}-{####}".
   *
   * Series-bound counters: `{####:<token>}` partitions the counter by
   * `data[<token>]`. The token is just a fieldname on the document — the
   * platform stays domain-neutral. Apps that need period-bound or
   * sequence-bound numbers compute the partition value into a regular field
   * (via `fetch_from`, a hook, or a defaulted value) and then reference it:
   * `{####:<fieldname>}`.
   *
   * Sequences are persisted in `_sequences` keyed by `<entity>:<seriesValue>`,
   * so per-series counters never collide. Bare `{####}` remains a global
   * per-entity counter.
   *
   * `keyField` is the field the resulting value will be stored under on the
   * target entity (`_id` for `generateId`, the declared business-key field
   * for `generateSeries`) — see `resolveUniqueSequence`.
   */
  private async evaluateNamingExpression(
    entityName: string,
    expression: string,
    data: Record<string, unknown>,
    target: DatabaseTarget = "app",
    session?: ClientSession,
    keyField: string = "_id",
  ): Promise<string> {
    const now = new Date();
    let result = expression;

    // Date tokens
    result = result.replace(/\{YYYY\}/g, String(now.getFullYear()));
    result = result.replace(/\{YY\}/g, String(now.getFullYear()).slice(-2));
    result = result.replace(/\{MM\}/g, String(now.getMonth() + 1).padStart(2, "0"));
    result = result.replace(/\{DD\}/g, String(now.getDate()).padStart(2, "0"));

    // Field tokens (e.g., {branch} → data.branch). Resolved before the
    // sequence token below (their `\w+` pattern never matches a `#`/`:`
    // sequence token, so the order is safe) so the self-heal loop further
    // down only ever has to rebuild the numeric part of `result`, not
    // re-read arbitrary fields on every retry.
    result = result.replace(/\{(\w+)\}/g, (_, field: string) => {
      const val = data[field];
      // H23: strip naming-template metacharacters from the interpolated user
      // value, so a field value like "{####}" or "{#:owner}" can't inject a
      // sequence/series token into the permanent business key — the sequence
      // regexes below run on the already-interpolated `result`.
      return val !== undefined ? String(val).replace(/[{}#:]/g, "") : "";
    });

    // Series-bound sequence token: {####:<token>}
    // (matched first so the bare {####} below doesn't grab it)
    const seriesMatch = result.match(/\{(#+):([\w]+)\}/);
    if (seriesMatch) {
      const padLength = seriesMatch[1]!.length;
      const seriesToken = seriesMatch[2]!;
      const seriesValue = this.resolveSeriesValue(seriesToken, data, entityName);
      const seqName = `${entityName}:${seriesValue}`;
      const template = result;
      const firstSeq = await this.db.getNextSequence(seqName, "naming_seq", target, session);
      // Replace `{####:<token>}` with the literal `<seriesValue>-<seq>` to
      // give a readable name out of the box (e.g. "DOC-2026-00001" when the
      // doc's `year_label` field is "2026").
      result = await this.resolveUniqueSequence(
        seqName,
        target,
        session,
        entityName,
        keyField,
        firstSeq,
        (seq) =>
          template.replace(
            /\{#+:[\w]+\}/,
            // Function replacement: return the value verbatim so `$`-patterns in
            // the user-controlled seriesValue (e.g. `$&`, `$'`) are NOT treated as
            // String.replace substitution tokens and re-injected into the key.
            () => `${seriesValue}-${String(seq).padStart(padLength, "0")}`,
          ),
      );
    } else {
      // Bare sequence token (e.g., {####} → global counter)
      const seqMatch = result.match(/\{(#+)\}/);
      if (seqMatch) {
        const padLength = seqMatch[1]!.length;
        const template = result;
        const firstSeq = await this.db.getNextSequence(entityName, "naming_seq", target, session);
        result = await this.resolveUniqueSequence(
          entityName,
          target,
          session,
          entityName,
          keyField,
          firstSeq,
          (seq) => template.replace(/\{#+\}/, String(seq).padStart(padLength, "0")),
        );
      }
    }

    return result;
  }

  /**
   * Advance a `{####...}` sequence and rebuild the candidate key until one is
   * found that no existing document in `collectionName` already holds under
   * `keyField`. The counter in `_sequences` is only ever incremented via the
   * atomic `getNextSequence` ($inc), so this converges monotonically even
   * under concurrent naming — it never reuses or rewinds a value.
   *
   * Self-heals a counter that lags behind pre-existing documents (seeded /
   * imported data, or a partial reset that recreated the counter at its
   * initial value while the collection still holds documents numbered ahead
   * of it — see schema-migrator.ts `initializeSequence`): instead of handing
   * out a key that collides with an existing document and failing the insert
   * on the unique index, it keeps advancing past the occupied range.
   *
   * Bounded so a genuinely unresolvable case (e.g. the candidate keyspace is
   * exhausted) fails fast with a clear error instead of looping forever.
   */
  private async resolveUniqueSequence(
    sequenceName: string,
    target: DatabaseTarget,
    session: ClientSession | undefined,
    collectionName: string,
    keyField: string,
    firstSeq: number,
    buildCandidate: (seq: number) => string,
  ): Promise<string> {
    let seq = firstSeq;
    let candidate = buildCandidate(seq);
    let skipped = 0;

    while (await this.db.existsByField(collectionName, keyField, candidate, target, session, { includeDeleted: true })) {
      skipped++;
      if (skipped > MAX_SEQUENCE_SKIP_ATTEMPTS) {
        // The counter lags far behind the stored keys; it is resynced out of band
        // (schema-migrator initializeSequence), not inside the insert transaction.
        throw new EngineError(
          "naming_sequence_exhausted",
          { sequence: sequenceName, field: keyField, attempts: String(MAX_SEQUENCE_SKIP_ATTEMPTS) },
          500,
          "NAMING_SEQUENCE_EXHAUSTED",
        );
      }
      seq = await this.db.getNextSequence(sequenceName, "naming_seq", target, session);
      candidate = buildCandidate(seq);
    }

    if (skipped > 0) {
      log.warn(
        { sequenceName, collectionName, keyField, skipped },
        "Naming sequence skipped already-occupied keys (counter drift self-healed)",
      );
    }

    return candidate;
  }

  /**
   * Resolve a series-token's partition value from the document's data.
   * Generic per-field partitioning — no built-in domain keywords. Apps that
   * want year/month/quarter/branch/region-bound counters populate the
   * relevant field on the doc (via fetch_from / hook / explicit input) and
   * then reference it in their naming expression.
   */
  private resolveSeriesValue(
    seriesToken: string,
    data: Record<string, unknown>,
    entityName: string,
  ): string {
    const v = data[seriesToken];
    if (v === undefined || v === null || v === "") {
      throw new NamingSeriesFieldEmptyError(entityName, seriesToken);
    }
    return String(v);
  }
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The counter an `expression` naming would have advanced to make `id`, and the number it gave:
 * `{####}` counts per entity, `{####:<field>}` per series value, as `evaluateNamingExpression`
 * keys them. Undefined for an id the expression could not have made. A seed moves the counter
 * past its own ids with it, so the first new document does not walk them.
 */
export function expressionSequenceOf(
  entityName: string,
  expression: string,
  id: string,
): { sequence: string; value: number } | undefined {
  let series = false;
  const pattern = expression
    .split(/(\{[^}]*\})/)
    .map((part) => {
      if (part === "{YYYY}") return "\\d{4}";
      if (part === "{YY}" || part === "{MM}" || part === "{DD}") return "\\d{2}";
      const seriesToken = /^\{(#+):\w+\}$/.exec(part);
      if (seriesToken) {
        series = true;
        return `(.+)-(\\d{${seriesToken[1]!.length},})`;
      }
      const sequenceToken = /^\{(#+)\}$/.exec(part);
      if (sequenceToken) return `(\\d{${sequenceToken[1]!.length},})`;
      if (/^\{\w+\}$/.test(part)) return "[^{}#:]*?";
      return escapeRegExp(part);
    })
    .join("");
  const match = new RegExp(`^${pattern}$`).exec(id);
  if (!match) return undefined;
  const value = Number(series ? match[2] : match[1]);
  if (!Number.isSafeInteger(value)) return undefined;
  return { sequence: series ? `${entityName}:${match[1]}` : entityName, value };
}
