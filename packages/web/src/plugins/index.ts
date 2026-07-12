import dynamic from "next/dynamic";
import type { PluginManifest, RenderComponent } from "@/catalog/types";

/**
 * Frontend plugin manifests — the escape hatch for bespoke interactive sections
 * when a generic block isn't enough. A `plugin` block carries `props.plugin_id`;
 * this maps it to a code-split component, and self-describes the plugin for a
 * future visual builder. (Distinct from the engine's digita-plugins runtime.)
 */
export const PLUGIN_MANIFESTS: PluginManifest[] = [
  {
    id: "metadata-demo",
    name: "Metadata demo",
    description:
      "Animated: one Sales Order definition generates a REST API + admin UI — naming series, child-table lines, computed totals, workflow.",
    category: "interactive",
    props: [],
    component: dynamic(() => import("./metadata-demo")),
  },
];

const BY_ID = new Map<string, RenderComponent>(PLUGIN_MANIFESTS.map((m) => [m.id, m.component]));

export function resolvePlugin(id: string | undefined): RenderComponent | null {
  if (!id) return null;
  return BY_ID.get(id) ?? null;
}
