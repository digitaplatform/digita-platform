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
  | "hero_brand"
  | "pillars"
  | "stack"
  | "pipeline"
  | "compare"
  | "checklist"
  | "segments"
  | "signals"
  | "cta_panel"
  | "contact_details"
  | "showcase"
  | "record_form"
  | "app_list"
  | "plugin";

export interface Block {
  type: BlockType;
  props?: Record<string, unknown>;
  anchor?: string;
  /** "dark" draws the block as a dark band on a light page. */
  theme_variant?: "dark";
  _row_id?: string;
}

export interface WebPage {
  _id: string;
  site: string;
  locale: string;
  slug: string;
  title: string;
  translation_group?: string;
  blocks?: Block[];
  meta_title?: string;
  meta_description?: string;
  og_image?: string;
  canonical_url?: string;
  no_index?: boolean;
  status?: string;
  modified?: string;
  /** Denormalized link display titles, keyed by fieldname (from the engine). */
  _link_titles?: Record<string, string>;
}

export interface WebSite {
  _id: string;
  site_name: string;
  domain?: string;
  /** The id of the signature the site is drawn in. */
  theme?: string;
  enabled_locales?: string[];
  default_og_image?: string;
  footer_text?: string;
  /** Where the contact sheet's requests are mailed to; without it the sheet is not offered. */
  contact_email?: string;
  /** The booking page the contact sheet links to; without it the booking button stays out. */
  booking_url?: string;
  /** Whether the header links the tenant's apps; only false hides them, so a row without the
   *  field keeps them linked. */
  link_apps?: boolean;
  /** Whether the band that switches the site's design shows above the footer. */
  design_switcher?: boolean;
  /** The atmosphere behind every hero_brand block that names none of its own: "data-rain" or "none". */
  hero_atmosphere?: string;
  /** The columns of that rain, shaped like the block prop `rain`: [{ "tokens": ["…"] }, …]. */
  hero_rain?: unknown;
}

/** A menu entry as the visitor sees it: `page` is the WebPage `_id` in the visitor's language. An entry
 *  with children is a heading over them. */
export interface NavItem {
  label: string;
  page?: string;
  href?: string;
  /** A lucide icon by its name (as lucide.dev lists it, "calendar-days"): the top bar of phones and
   *  tablets shows a header item as this icon, since it has no room for the item's label. */
  icon?: string;
  children?: NavItem[];
}

/** A node of a site's menu tree, one for all languages: the tree block of `tree.menu: "website"`. */
export interface WebNavMenu {
  _id: string;
  label: string;
  parent?: string | null;
  position?: number | null;
  icon?: string | null;
  site: string;
  location: "header" | "footer" | "family";
  page?: string | null;
  href?: string | null;
}

/** The tenant branding the engine's anonymous boot returns: the fields the website renders. */
export interface WebBranding {
  /** The name the tenant gave itself; a set name renders as text, never under the signature's wordmark. */
  app_name?: string;
  primary_color?: string | null;
  accent_palette?: string | null;
  density?: "comfortable" | "compact" | null;
  logo?: string;
  /** false: the tenant locks light/dark, so the site offers no mode button and paints the system mode. */
  allow_user_theme_mode?: boolean;
}
