/**
 * Master-data import/export DTOs — shared by the engine (import-export
 * services + router) and digita-ui (ImportWizard). Everything is generic and
 * metadata-driven; there is no entity-specific shape here.
 */

/** How an import applies each row. */
export type ImportMode =
  /** Always create; a business-key collision fails loud on the unique index. */
  | "insert"
  /** Create when the business key is new, update the existing doc otherwise. */
  | "upsert"
  /** Dry run: full parse + resolve + Zod + link + permission checks, ZERO writes. */
  | "validate";

/** One row-level (or file-level, row=0) import problem. */
export interface ImportRowError {
  /** 1-based row number in the uploaded file; 0 = file-level. */
  row: number;
  /** Dotted field path when the error is field-specific (e.g. `lines[2].account`). */
  field?: string;
  /** Human-readable message (already resolved server-side). */
  message: string;
  /** i18n key for clients that re-translate. */
  message_key?: string;
  params?: Record<string, string>;
}

/** The outcome of an import (or dry run). */
export interface ImportReport {
  mode: ImportMode;
  dry_run: boolean;
  /** Total rows submitted. */
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: ImportRowError[];
  /** Non-fatal notices (e.g. stripped system columns). */
  warnings: string[];
}

/** Request body for `POST /import/:doctype`. Exactly one of `rows` | `csv`. */
export interface ImportRequestBody {
  rows?: Record<string, unknown>[];
  csv?: string;
  mode?: ImportMode;
}

/** How Link fields are rendered on export. */
export type ExportLinkFormat = "id" | "business_key";
