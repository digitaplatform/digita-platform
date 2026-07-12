import type { ThemeManifest } from "@/catalog/types";

/**
 * Theme manifests. A theme is selected per site via `WebSite.theme` (content-
 * driven) and is a pure additive CSS-variable layer (scoped by htmlClass; see
 * src/themes/<id>/theme.css) — it never touches renderer logic, so themes are
 * swappable/extendable without breaking anything. The base theme uses the
 * @digitaplatform/theme foundation as-is. Self-describing for a future theme picker.
 */
export const THEME_MANIFESTS: ThemeManifest[] = [
  { id: "base", name: "Base", description: "The @digitaplatform/theme token foundation, unbranded." },
  {
    id: "digitaplatform",
    name: "Digita Platform",
    description: "Indigo-violet brand theme over the @digitaplatform/theme base (light + dark).",
    htmlClass: "theme-digitaplatform",
  },
];

const BY_ID = new Map(THEME_MANIFESTS.map((m) => [m.id, m]));

/** Resolve a theme id → manifest; unknown/empty falls back to base (render
 *  resilience — a typo'd WebSite.theme must not break the site). */
export function resolveTheme(id?: string | null): ThemeManifest {
  return (id ? BY_ID.get(id) : undefined) ?? BY_ID.get("base")!;
}
