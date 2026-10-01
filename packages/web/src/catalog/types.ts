import type { ComponentType } from "react";
import type { BlockType, WebSite } from "@/lib/types";
import type { Locale } from "@/i18n/config";

/** A plugin's component: it renders from the `props` bag of the block that names it and the page's
 *  locale, for the chrome texts it carries, such as a status pill. */
export type PluginComponent = ComponentType<{ props?: Record<string, unknown>; locale: Locale }>;

/** A block's component. Beside a plugin's inputs it gets `site`, what a site sets once for all its
 *  pages, such as the hero's atmosphere. */
export type BlockComponent = ComponentType<{ props?: Record<string, unknown>; locale: Locale; site: WebSite | null }>;

/** What the renderer knows of each block and plugin: the component it renders with. The name,
 *  description and category tell a reader of the source what it is. */
export interface BlockManifest {
  type: BlockType;
  name: string;
  description: string;
  category: "content" | "media" | "interactive";
  component: BlockComponent;
}

export interface PluginManifest {
  id: string;
  name: string;
  description: string;
  category: "interactive" | "media";
  component: PluginComponent;
}
