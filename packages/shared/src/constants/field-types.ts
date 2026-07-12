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

export const TEXT_FIELD_TYPES: readonly FieldType[] = [
  "Data",
  "Text",
  "SmallText",
  "TextEditor",
  "Code",
  "Markdown",
  "Phone",
];

export const DATE_FIELD_TYPES: readonly FieldType[] = ["Date", "Datetime", "Time"];

export const LINK_FIELD_TYPES: readonly FieldType[] = ["Link"];

export const FILE_FIELD_TYPES: readonly FieldType[] = ["Attach", "AttachImage"];

export const DATA_FORMAT_OPTIONS = ["Email", "Phone", "URL", "IP", "Name"] as const;

export type DataFormatOption = (typeof DATA_FORMAT_OPTIONS)[number];
