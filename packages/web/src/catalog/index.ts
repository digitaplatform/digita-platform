import { BLOCK_MANIFESTS } from "@/blocks/registry";
import { PLUGIN_MANIFESTS } from "@/plugins";
import type { Catalog } from "./types";

/**
 * The serializable catalog of what this renderer can place: block types and
 * plugins, each with its configurable `props` schema (components stripped).
 * A visual builder fetches this (GET /api/catalog) to drive its palette + forms.
 */
export function buildCatalog(): Catalog {
  return {
    blocks: BLOCK_MANIFESTS.map(({ component: _component, ...rest }) => rest),
    plugins: PLUGIN_MANIFESTS.map(({ component: _component, ...rest }) => rest),
  };
}

export type { Catalog } from "./types";
