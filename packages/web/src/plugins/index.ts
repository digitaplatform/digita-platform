import dynamic from "next/dynamic";
import type { PluginComponent, PluginManifest } from "@/catalog/types";

/**
 * Frontend plugin manifests — the escape hatch for bespoke sections when a generic block isn't
 * enough. A `plugin` or `showcase` block carries `props.plugin_id`, a `hero_brand` block names its
 * figure in `props.visual`; this maps the id to a code-split component. (Distinct from the
 * engine's digita-plugins runtime.)
 */
export const PLUGIN_MANIFESTS: PluginManifest[] = [
  {
    id: "metadata-demo",
    name: "Metadata demo",
    description:
      "Animated: one Sales Order definition generates a REST API + admin UI — naming series, child-table lines, computed totals, workflow.",
    category: "interactive",
    component: dynamic(() => import("./metadata-demo")),
  },
  {
    id: "brand-mark",
    name: "Brand mark",
    description: "The site's own mark, the monogram of the signature its theme names, with a pulsing aura.",
    category: "media",
    component: dynamic(() => import("./brand-mark")),
  },
  {
    id: "code-app",
    name: "Code app",
    description: "A generated form that dissolves into the definition it came from on hover or tap.",
    category: "interactive",
    component: dynamic(() => import("./code-app")),
  },
];

const BY_ID = new Map<string, PluginComponent>(PLUGIN_MANIFESTS.map((m) => [m.id, m.component]));

export function resolvePlugin(id: string | undefined): PluginComponent | null {
  if (!id) return null;
  return BY_ID.get(id) ?? null;
}
