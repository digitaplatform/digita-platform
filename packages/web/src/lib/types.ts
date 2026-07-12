/** Content shapes returned by the engine public read API (subset we render). */

export type BlockType =
  | "hero"
  | "richtext"
  | "feature_grid"
  | "media"
  | "cta"
  | "stats"
  | "embed"
  | "code"
  | "plugin";

export interface Block {
  type: BlockType;
  props?: Record<string, unknown>;
  anchor?: string;
  theme_variant?: string;
  _row_id?: string;
}

export interface WebPage {
  _id: string;
  site: string;
  locale: string;
  slug: string;
  title: string;
  nav_label?: string;
  translation_group?: string;
  blocks?: Block[];
  meta_title?: string;
  meta_description?: string;
  og_image?: string;
  canonical_url?: string;
  no_index?: boolean;
  status?: string;
  published_at?: string;
  modified?: string;
  /** Denormalized link display titles, keyed by fieldname (from the engine). */
  _link_titles?: Record<string, string>;
}

export interface WebSite {
  _id: string;
  site_name: string;
  domain?: string;
  theme?: string;
  default_locale?: string;
  enabled_locales?: string[];
  default_og_image?: string;
  footer_text?: string;
}

export interface NavItem {
  label: string;
  page?: string;
  href?: string;
  order?: number;
}

export interface WebNavMenu {
  _id: string;
  site: string;
  locale: string;
  location: string;
  items?: NavItem[];
}
