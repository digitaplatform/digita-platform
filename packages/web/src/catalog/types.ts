import type { ComponentType } from "react";
import type { BlockType } from "@/lib/types";
import type { Locale } from "@/i18n/config";

/**
 * Self-describing contracts for blocks and plugins. A future visual
 * builder reads these (via /api/catalog) to ENUMERATE what's available,
 * CONFIGURE each via its `props` schema, and PLACE it on a page — without
 * knowing the renderer's internals. Kept deliberately close to the engine's own
 * field-descriptor vocabulary so the website builder feels like the metadata UI.
 */

/** A configurable prop, described like an engine field so a builder can form-render it. */
export type PropType =
  | "text"
  | "textarea"
  | "url"
  | "number"
  | "boolean"
  | "select"
  | "code"
  | "media"
  | "list"
  | "object";

export interface PropField {
  name: string;
  label: string;
  type: PropType;
  required?: boolean;
  /** Options for `select`. */
  options?: string[];
  /** Item shape for `list` (a repeatable group, e.g. feature-grid items) and the members of an
   *  `object` (one group, e.g. a call to action). A `list` without it holds lines of text. */
  itemFields?: PropField[];
  help?: string;
}

/** A component that renders from a JSON `props` bag and the page's locale, for the chrome texts it
 *  carries, such as a status pill. Blocks and plugins share it. */
export type BlockComponent = ComponentType<{ props?: Record<string, unknown>; locale: Locale }>;

export interface BlockManifest {
  type: BlockType;
  name: string;
  description: string;
  /** Grouping for the builder palette. */
  category: "content" | "media" | "interactive";
  props: PropField[];
  component: BlockComponent;
}

export interface PluginManifest {
  id: string;
  name: string;
  description: string;
  category: "interactive" | "media";
  props: PropField[];
  component: BlockComponent;
}

/** Serializable catalog entry (no component) — what /api/catalog returns. */
export type CatalogBlock = Omit<BlockManifest, "component">;
export type CatalogPlugin = Omit<PluginManifest, "component">;
export interface Catalog {
  blocks: CatalogBlock[];
  plugins: CatalogPlugin[];
}
