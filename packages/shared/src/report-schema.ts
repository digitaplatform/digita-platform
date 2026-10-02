import { z } from "zod";
import { allowedBarcodeSymbologies, isAllowedBarcodeSymbology, safeCssColor, safeCssFontFamily } from "./css-values.js";
import { REPORT_SCHEMA_VERSION, type ReportBand, type ReportDefinition } from "./types/report.js";

/**
 * Field names of a report become Mongo query keys, so a name holds letters, digits, `_` and `.`
 * only, never starts with `.` and never holds `..`: no operator ($where and the like) and no path
 * trick reaches a query, even from a tenant's designer.
 */
const SAFE_FIELD = /^[a-zA-Z0-9_][a-zA-Z0-9_.]*$/;

/** Whether `field` is a field name a report may put into a query. */
export function isSafeField(field: string): boolean {
  return SAFE_FIELD.test(field) && !field.includes("..");
}

/**
 * Zod validation for report definitions, published as the subpath
 * `@digitaplatform/shared/report-schema`, so only a consumer of this subpath loads zod; the
 * package's root stays dependency-free. The TypeScript contract is types/report.ts; this schema is
 * bound to it via the `satisfies`/ZodType annotations below so drift fails the build.
 *
 * SECURITY: every field whose value is concatenated into CSS by the renderer is
 * validated against the shared allow-grammar HERE — fail closed, at write time,
 * with a 400 naming the field. The renderer validates again at paint time (and
 * merely drops the declaration), because definitions stored before this schema
 * existed must not become unrenderable. Two layers, one grammar.
 */

/** A CSS colour: hex, named, or a purely numeric rgb()/rgba()/hsl()/hsla(). */
const cssColor = z.string().refine((v) => safeCssColor(v) !== null, {
  message:
    "must be a CSS colour — #hex, a named colour, or rgb()/rgba()/hsl()/hsla() with numeric arguments; url(), declaration lists and functions are rejected",
});

/** A CSS font-family list of generic keywords, bare names, or quoted names. */
const cssFontFamily = z.string().refine((v) => safeCssFontFamily(v) !== null, {
  message:
    "must be a CSS font-family list — generic keywords, bare family names, or quoted names, separated by commas",
});

const styleSchema = z
  .object({
    font_family: cssFontFamily.optional(),
    font_size_pt: z.number().positive().optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    color: cssColor.optional(),
    background: cssColor.optional(),
    border: z
      .object({
        width_pt: z.number().nonnegative(),
        color: cssColor,
        sides: z.array(z.enum(["top", "right", "bottom", "left"])).optional(),
      })
      .optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    valign: z.enum(["top", "middle", "bottom"]).optional(),
    padding_mm: z.number().nonnegative().optional(),
    line_height: z.number().positive().optional(),
  })
  .strict();

const formatSchema = z
  .object({
    type: z.enum(["number", "currency", "date", "datetime", "percent", "boolean"]),
    currency: z.string().length(3).optional(),
    decimals: z.number().int().min(0).max(8).optional(),
    date_style: z.enum(["short", "medium", "long"]).optional(),
  })
  .strict()
  // A currency format needs an EXPLICIT ISO code — never a silent EUR default.
  .refine((f) => f.type !== "currency" || f.currency !== undefined, {
    message: "currency format requires an explicit currency (ISO 4217, e.g. EUR/USD/CHF)",
    path: ["currency"],
  });

const objectBase = {
  id: z.string().min(1),
  x_mm: z.number(),
  y_mm: z.number(),
  w_mm: z.number().positive(),
  h_mm: z.number().positive(),
  style: styleSchema.optional(),
};

const tableCellSchema = z
  .object({
    content: z.string(),
    format: formatSchema.optional(),
    style: styleSchema.optional(),
    colspan: z.number().int().min(1).max(50).optional(),
    rowspan: z.number().int().min(1).max(200).optional(),
  })
  .strict();

const objectSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...objectBase,
      type: z.literal("text"),
      content: z.string(),
      format: formatSchema.optional(),
      can_grow: z.boolean().optional(),
    })
    .strict(),
  z
    .object({ ...objectBase, type: z.literal("image"), src: z.string().optional(), binding: z.string().optional() })
    .strict(),
  z
    .object({ ...objectBase, type: z.literal("line"), direction: z.enum(["horizontal", "vertical"]).optional() })
    .strict(),
  z
    .object({
      ...objectBase,
      type: z.literal("rect"),
      radius_mm: z.number().nonnegative().optional(),
      shape: z.enum(["rectangle", "ellipse"]).optional(),
    })
    .strict(),
  z
    .object({
      ...objectBase,
      type: z.literal("gauge"),
      kind: z.enum(["radial", "linear"]),
      value: z.string().min(1),
      min: z.number().optional(),
      max: z.number().optional(),
      target: z.number().optional(),
      format: formatSchema.optional(),
      show_value: z.boolean().optional(),
      color: cssColor.optional(),
      track_color: cssColor.optional(),
    })
    .strict(),
  z
    .object({
      ...objectBase,
      type: z.literal("barcode"),
      // The renderer inserts bwip-js' SVG output unescaped, so the symbology
      // bounds which of its code paths author input can reach.
      symbology: z.string().refine(isAllowedBarcodeSymbology, {
        message: `unsupported barcode symbology — one of: ${allowedBarcodeSymbologies().join(", ")}`,
      }),
      value: z.string().min(1),
      show_text: z.boolean().optional(),
    })
    .strict(),
  z.object({ ...objectBase, type: z.literal("checkbox"), binding: z.string().min(1) }).strict(),
  z
    .object({
      ...objectBase,
      type: z.literal("matrix"),
      row_by: z.string().min(1),
      col_by: z.string().min(1).optional(),
      value: z
        .object({
          fn: z.enum(["sum", "count", "avg", "min", "max"]),
          path: z.string().min(1).optional(),
          format: formatSchema.optional(),
        })
        .strict()
        .refine((v) => v.fn === "count" || v.path !== undefined, {
          message: "value.path is required for every fn except count",
        }),
      row_header_w_mm: z.number().positive(),
      col_w_mm: z.number().positive(),
      row_h_mm: z.number().positive(),
      show_totals: z.boolean().optional(),
      header_style: styleSchema.optional(),
      cell_style: styleSchema.optional(),
      total_style: styleSchema.optional(),
      collection: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      ...objectBase,
      type: z.literal("table"),
      columns_mm: z.array(z.number().positive()).min(1).max(50),
      rows: z
        .array(
          z
            .object({ height_mm: z.number().positive(), cells: z.array(tableCellSchema) })
            .strict(),
        )
        .min(1)
        .max(200),
      cell_border: z.object({ width_pt: z.number().nonnegative(), color: cssColor }).strict().optional(),
    })
    .strict(),
]);

const bandTypeSchema = z.enum([
  "report-title",
  "page-header",
  "group-header",
  "data",
  "group-footer",
  "page-footer",
  "report-summary",
]);

const filterTupleSchema = z.tuple([
  z.string().min(1),
  z.enum(["=", "!=", ">", ">=", "<", "<=", "in", "like"]),
  z.unknown(),
]);

const sortSchema = z.array(
  z.object({ field: z.string().min(1), dir: z.union([z.literal(1), z.literal(-1)]) }).strict(),
);

const groupSchema = z.object({ by: z.string().min(1) }).strict();

/**
 * A join field becomes a Mongo query/pipeline KEY — the SAFE_FIELD grammar
 * (shared with the filter builder) blocks operator injection at write time.
 */
const safeFieldSchema = z.string().refine(isSafeField, {
  message: "field must be a dot path of [a-zA-Z0-9_] segments (no Mongo operators)",
});

const joinSortSchema = z.array(
  z.object({ field: safeFieldSchema, dir: z.union([z.literal(1), z.literal(-1)]) }).strict(),
);

/** Aliases a join must never use — Mongo's `_id` key, the JS prototype keys, which would hit the
 *  Object.prototype setter in normalizeBson, and the key field a join removes after its lookup. */
const RESERVED_JOIN_ALIAS = new Set(["_id", "__proto__", "constructor", "prototype", "__join_key"]);

/** One equality pair of a multi-field join. */
const joinOnSchema = z
  .object({ local_field: safeFieldSchema, foreign_field: safeFieldSchema })
  .strict();

/**
 * Row-level join ($lookup) on a collection. SAME database only — `database`
 * is accepted purely so a cross-DB attempt fails with a MEANINGFUL error in
 * the collection-level superRefine below, not as an opaque unknown-key 400.
 */
const joinSchema = z
  .object({
    as: z
      .string()
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "join alias must be an identifier")
      .refine((v) => !RESERVED_JOIN_ALIAS.has(v), {
        message: "join alias must not be a reserved name (_id / __proto__ / constructor / prototype)",
      }),
    collection: z.string().regex(/^[A-Za-z0-9_]+$/, "collection = entity name"),
    database: z.string().optional(),
    local_field: safeFieldSchema.optional(),
    foreign_field: safeFieldSchema.optional(),
    on: joinOnSchema.array().min(1).optional(),
    filters: z.array(filterTupleSchema).optional(),
    sort: joinSortSchema.optional(),
    limit: z.number().int().min(1).max(5000).optional(),
    single: z.boolean().optional(),
  })
  .strict()
  .superRefine((j, ctx) => {
    const hasSimple = j.local_field !== undefined || j.foreign_field !== undefined;
    const hasOn = j.on !== undefined;
    if (hasSimple && hasOn) {
      ctx.addIssue({ code: "custom", path: ["on"], message: "join declares either local_field+foreign_field or on[] — not both" });
    } else if (!hasSimple && !hasOn) {
      ctx.addIssue({ code: "custom", path: ["local_field"], message: "join needs local_field+foreign_field (simple) or on[] (multi-field)" });
    } else if (hasSimple && (j.local_field === undefined || j.foreign_field === undefined)) {
      ctx.addIssue({ code: "custom", path: [j.local_field === undefined ? "local_field" : "foreign_field"], message: "a simple join needs BOTH local_field and foreign_field" });
    }
  });

/** One named collection in data.collections — a source with its own filters/sort/cap. */
const collectionSchema = z
  .object({
    // An app name may carry a hyphen (simetrix-ch_content), so a logical database may too.
    database: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, "logical database like erp_sales"),
    collection: z.string().regex(/^[A-Za-z0-9_]+$/, "collection = entity name"),
    filters: z.array(filterTupleSchema).optional(),
    sort: sortSchema.optional(),
    limit: z.number().int().positive().optional(),
    joins: z.array(joinSchema).max(5).optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const seen = new Set<string>();
    (c.joins ?? []).forEach((join, ji) => {
      if (seen.has(join.as)) {
        ctx.addIssue({ code: "custom", path: ["joins", ji, "as"], message: `duplicate join alias "${join.as}" — aliases must be unique per collection` });
      }
      seen.add(join.as);
      // LOUD cross-DB rejection: $lookup cannot leave the parent's database.
      // An equal database is tolerated (and ignored — it adds no information).
      if (join.database !== undefined && join.database !== c.database) {
        ctx.addIssue({
          code: "custom",
          path: ["joins", ji, "database"],
          message:
            "cross-database joins are not supported (MongoDB $lookup is same-database only) — the join target must live in the parent collection's database; for cross-database master-detail use a nested lookup band",
        });
      }
    });
  });

const lookupSchema = z
  .object({
    database: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
    collection: z.string().regex(/^[A-Za-z0-9_]+$/),
    local_field: z.string().min(1),
    foreign_field: z.string().min(1),
    filters: z.array(filterTupleSchema).optional(),
    sort: sortSchema.optional(),
    limit: z.number().int().positive().max(5000).optional(),
  })
  .strict();

const bandSchema: z.ZodType<ReportBand> = z.lazy(() =>
  z
    .object({
      id: z.string().min(1),
      type: bandTypeSchema,
      height_mm: z.number().positive(),
      objects: z.array(objectSchema),
      group_level: z.number().int().min(0).max(2).optional(),
      binding: z
        .object({
          collection: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).optional(),
          path: z.string().min(1).optional(),
          lookup: lookupSchema.optional(),
        })
        .strict()
        .refine((b) => [b.collection, b.path, b.lookup].filter((v) => v !== undefined).length === 1, {
          message:
            "binding needs exactly one of collection (top-level section), path (embedded array) or lookup (referenced collection)",
        })
        .optional(),
      section: z.string().min(1).optional(),
      groups: z.array(groupSchema).max(3, "up to 3 group levels").optional(),
      bands: z.array(bandSchema).optional(),
      at_page_foot: z.boolean().optional(),
    })
    .strict()
    .refine((b) => b.at_page_foot === undefined || b.type === "report-summary", {
      message: "at_page_foot is only for report-summary bands",
      path: ["at_page_foot"],
    }),
) as z.ZodType<ReportBand>;

/**
 * Upper bound on a page dimension (mm). A designer-supplied page size drives
 * the PNG screenshot viewport (px = mm × `PX_PER_MM` × deviceScaleFactor — the
 * constant lives in `@digitaplatform/shared`); an unbounded value (e.g. 100000mm)
 * allocates a multi-gigapixel bitmap that OOM-kills the shared Chromium. 2000mm
 * comfortably covers every real paper size (ISO A0 long side is 1189mm) plus
 * large-format banners.
 */
export const PAGE_MAX_MM = 2000;

const paramSchema = z
  .object({
    name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
    type: z.enum(["string", "number", "date", "boolean", "list"]),
    label: z.string().optional(),
    required: z.boolean().optional(),
    default: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  })
  .strict();

export const reportDefinitionSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "name must be lowercase kebab-case"),
    title: z.string().min(1),
    description: z.string().optional(),
    tags: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "tags must be lowercase kebab-case"))
      .max(8, "up to 8 tags")
      .optional(),
    // Explicit app-affiliation mark (list grouping); unset = derived from the
    // collections' logical databases (reportApps() in @digitaplatform/shared).
    app: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/, "app must be lowercase kebab-case")
      .optional(),
    sample_params: z.record(z.string(), z.unknown()).optional(),
    schema_version: z.literal(REPORT_SCHEMA_VERSION),
    locale: z.string().optional(),
    // Per-language chrome overlay: BCP-47 tag → { objects: { objectId → template } }.
    i18n: z
      .record(
        z.string(),
        z.object({ objects: z.record(z.string(), z.string()).optional() }).strict(),
      )
      .optional(),
    page: z
      .object({
        width_mm: z.number().positive().max(PAGE_MAX_MM),
        height_mm: z.number().positive().max(PAGE_MAX_MM),
        margins_mm: z
          .object({
            top: z.number().nonnegative(),
            right: z.number().nonnegative(),
            bottom: z.number().nonnegative(),
            left: z.number().nonnegative(),
          })
          .strict(),
        watermark: z
          .object({
            text: z.string().min(1),
            opacity: z.number().min(0).max(1).optional(),
            angle: z.number().optional(),
            font_size: z.number().positive().optional(),
            color: cssColor.optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    data: z
      .object({
        collections: z
          .record(
            z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "collection name must be an identifier"),
            collectionSchema,
          )
          .refine((c) => Object.keys(c).length >= 1, {
            message: "data.collections needs at least one named collection",
          }),
        params: z.array(paramSchema).optional(),
      })
      .strict(),
    bands: z.array(bandSchema),
    permissions: z
      .object({
        run_roles: z.array(z.string()).optional(),
        edit_roles: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  // Cross-references the recursive/lazy bandSchema cannot see: collection names,
  // section ids, top-level-only bindings, matrix scope.
  .superRefine((raw, ctx) => {
    const def = raw as ReportDefinition;
    const names = new Set(Object.keys(def.data.collections));
    const sectionIds = new Set(def.bands.filter((b) => b.type === "data").map((b) => b.id));
    const scopeless = new Set(["report-title", "page-header", "page-footer"]);
    const declared = () => [...names].sort().join(", ");

    // Nested bands carry NO collection binding and NO groups (top-level only).
    const rejectNested = (band: ReportBand, path: (string | number)[]): void => {
      for (const [i, child] of (band.bands ?? []).entries()) {
        const p = [...path, "bands", i];
        if (child.binding?.collection !== undefined) {
          ctx.addIssue({ code: "custom", path: [...p, "binding", "collection"], message: "binding.collection is only valid on top-level data bands — nested bands use path or lookup" });
        }
        if (child.groups !== undefined) {
          ctx.addIssue({ code: "custom", path: [...p, "groups"], message: "groups are only valid on top-level data bands" });
        }
        rejectNested(child, p);
      }
    };
    // A matrix must resolve a feeding collection: declared one must exist; a matrix
    // in a scopeless band (title/page-header/page-footer) MUST declare it.
    const checkMatrix = (band: ReportBand, path: (string | number)[]): void => {
      band.objects.forEach((o, oi) => {
        if (o.type !== "matrix") return;
        const p = [...path, "objects", oi, "collection"];
        if (o.collection !== undefined && !names.has(o.collection)) {
          ctx.addIssue({ code: "custom", path: p, message: `matrix references unknown collection "${o.collection}" — declared: ${declared()}` });
        } else if (o.collection === undefined && scopeless.has(band.type)) {
          ctx.addIssue({ code: "custom", path: p, message: `matrix in a ${band.type} band must declare collection (no data-band scope here)` });
        }
      });
      (band.bands ?? []).forEach((child, ci) => checkMatrix(child, [...path, "bands", ci]));
    };

    def.bands.forEach((band, i) => {
      const bp: (string | number)[] = ["bands", i];
      if (band.type === "data") {
        const name = band.binding?.collection;
        if (name === undefined) {
          ctx.addIssue({ code: "custom", path: [...bp, "binding"], message: "top-level data band must declare binding.collection (a key of data.collections)" });
        } else if (!names.has(name)) {
          ctx.addIssue({ code: "custom", path: [...bp, "binding", "collection"], message: `unknown collection "${name}" — declared: ${declared()}` });
        }
      }
      if (band.type === "group-header" || band.type === "group-footer") {
        if (band.section === undefined) {
          ctx.addIssue({ code: "custom", path: [...bp, "section"], message: `${band.type} must declare section (the id of a top-level data band)` });
        } else if (!sectionIds.has(band.section)) {
          ctx.addIssue({ code: "custom", path: [...bp, "section"], message: `unknown section "${band.section}" — not a top-level data band` });
        }
      }
      if (band.type === "report-summary" && band.section !== undefined && !sectionIds.has(band.section)) {
        ctx.addIssue({ code: "custom", path: [...bp, "section"], message: `unknown section "${band.section}" — not a top-level data band` });
      }
      rejectNested(band, bp);
      checkMatrix(band, bp);
    });
  });

/** A report definition from an unknown payload, such as a `*.report.json` file. Throws the ZodError,
 *  which names every refused field by its path. */
export function parseReportDefinition(input: unknown): ReportDefinition {
  return reportDefinitionSchema.parse(input) as ReportDefinition;
}

/** One refusal of a report definition: the path of the refused value and why. */
export interface ReportDefinitionError {
  path: string;
  message: string;
}

/**
 * Every refusal of `input` as a report definition, as the report service refuses it at save and at
 * its boot; empty for a valid definition. A catalog checks its report files with it before any
 * tenant boots them.
 */
export function validateReportDefinition(input: unknown): ReportDefinitionError[] {
  const result = reportDefinitionSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}
