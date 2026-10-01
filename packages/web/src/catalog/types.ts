import type { ComponentType } from "react";
import type { BlockType, WebSite } from "@/lib/types";
import type { Locale } from "@/i18n/config";

/**
 * The contracts of blocks and plugins: the component each renders with, and a `props` schema that
 * describes its configurable fields in the engine's own field-descriptor vocabulary. Nothing in
 * the renderer reads a schema, so it documents what a block takes and is checked against nothing.
 */

/** A configurable prop, described like an engine field. */
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

/** A plugin's component: it renders from the `props` bag of the block that names it and the page's
 *  locale, for the chrome texts it carries, such as a status pill. */
export type PluginComponent = ComponentType<{ props?: Record<string, unknown>; locale: Locale }>;

/** A block's component. Beside a plugin's inputs it gets `site`, what a site sets once for all its
 *  pages, such as the hero's atmosphere. */
export type BlockComponent = ComponentType<{ props?: Record<string, unknown>; locale: Locale; site: WebSite | null }>;

export interface BlockManifest {
  type: BlockType;
  name: string;
  description: string;
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
  component: PluginComponent;
}
