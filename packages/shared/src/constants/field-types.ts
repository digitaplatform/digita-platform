import type { FieldType } from "../types/entity.js";

export const STORED_FIELD_TYPES: readonly FieldType[] = [
  "Data",
  "Text",
  "SmallText",
  "TextEditor",
  "Code",
  "Markdown",
  "Int",
  "Float",
  "Currency",
  "Percent",
  "Check",
  "Date",
  "Datetime",
  "Time",
  "Duration",
  "Select",
  "Link",
  "Table",
  "Attach",
  "AttachImage",
  "Image",
  "Password",
  "JSON",
  "Geolocation",
  "Signature",
  "Rating",
  "Barcode",
  "Color",
  "Tag",
  "Phone",
];

export const NUMERIC_FIELD_TYPES: readonly FieldType[] = [
  "Int",
  "Float",
  "Currency",
  "Percent",
  "Rating",
  "Duration",
];

/** The field types a person uploads a file into. Each upload lands under the entity's storage_path. */
export const UPLOAD_FIELD_TYPES = ["Attach", "AttachImage"] as const satisfies readonly FieldType[];

/**
 * The field types whose value is the URL of a File row, so the file is read, bound, copied and
 * cleaned up with the record that holds it. Image is one: it takes no upload of its own and shows a
 * file URL that a seed, an API client or a copy of an upload field set.
 */
export const FILE_FIELD_TYPES = [...UPLOAD_FIELD_TYPES, "Image"] as const satisfies readonly FieldType[];
