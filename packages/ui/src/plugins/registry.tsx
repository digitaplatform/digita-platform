import type { FrontendPlugin, PluginModule, PluginManifestEntry, LayoutConfig } from '@digitaplatform/plugins';
import { ErrorBoundary } from '@digitaplatform/components';
import { usePluginLayoutStore } from '@/stores/plugin-state';

// Plugins loaded for this session. The host ships NONE — every plugin is
// app-provided and loaded at runtime from the manifest. A future build-time
// path could call registerPlugin() directly; the rest is identical.
const loaded = new Map<string, FrontendPlugin>();

export function registerPlugin(plugin: FrontendPlugin): void {
  loaded.set(plugin.id, plugin);
}

// Dev only: load plugin implementations from their workspace SOURCE so the whole
// app is ONE Vite module graph — a single React instance + a single
// @digitaplatform/plugins host-services singleton, plus hot-reload of plugin edits. The
// built /public ESM bundle (the prod federation path) can't be import()ed as a
// module by the dev server AND would pull a second React. The glob is statically
// extracted by Vite but the import.meta.env.DEV guard tree-shakes it (and the
// plugin sources) out of the production build, which keeps using the manifest URL.
const devPluginSources: Record<string, () => Promise<unknown>> = import.meta.env.DEV
  ? import.meta.glob([
      '../../../../../digita-plugins-community/plugins/*/src/index.tsx',
      '../../../../../digita-plugins-premium/plugins/*/src/index.tsx',
    ])
  : {};

function devSourceLoader(id: string): (() => Promise<unknown>) | undefined {
  const key = Object.keys(devPluginSources).find((p) => p.includes(`/plugins/${id}/src/`));
  return key ? devPluginSources[key] : undefined;
}

/**
 * Load every app plugin in the manifest. In dev each is imported from its
 * workspace source (single React graph); in prod each is dynamically imported as
 * its ESM bundle (`@vite-ignore` — the URL is a runtime remote, not a build
 * input), with React + the other shared singletons resolved via the host's
 * import-map so plugin components compose with the host's React tree.
 */
export async function loadPluginsFromManifest(entries: PluginManifestEntry[]): Promise<void> {
  await Promise.all(
    entries.map(async (entry) => {
      try {
        const devLoader = devSourceLoader(entry.id);
        const mod = (devLoader
          ? await devLoader()
          : await import(/* @vite-ignore */ entry.url)) as PluginModule;
        const plugin = mod.plugin ?? mod.default;
        if (plugin?.id) registerPlugin(plugin);
        else console.error(`[plugins] "${entry.id}" exposes no plugin/default export`);
      } catch (err) {
        console.error(`[plugins] failed to load "${entry.id}" from ${entry.url}`, err);
      }
    }),
  );
}

// Placement: which plugin fills which template region. Backed by a reactive store
// (usePluginLayoutStore) so the shell re-renders when it's (re)loaded — e.g. after
// an in-app login (see the store's doc comment).
export function setLayoutConfig(config: LayoutConfig): void {
  usePluginLayoutStore.getState().setLayout(config);
}
export function getLayoutConfig(): LayoutConfig {
  return usePluginLayoutStore.getState().layout;
}
export function getRegionPlugin(region: string): FrontendPlugin | undefined {
  const id = usePluginLayoutStore.getState().layout.regions[region];
  return id ? loaded.get(id) : undefined;
}

/**
 * Render whatever plugin the layout config placed into `name`. The template
 * decides WHERE the region sits; this renders WHAT the config put there. If a
 * plugin is PLACED but not loaded (manifest miss / failed import), surface it
 * loudly rather than a silently empty region. A render error in the plugin is
 * contained by an error boundary so it can't crash the whole shell.
 */
export function Region({ name }: { name: string }) {
  // Reactive read so the region paints as soon as the composition loads (post-login).
  const id = usePluginLayoutStore((s) => s.layout.regions[name]);
  if (!id) return null; // nothing placed here — fine
  const plugin = loaded.get(id);
  if (!plugin) {
    return <p className="p-4 text-sm text-error">Plugin “{id}” is placed here but not loaded.</p>;
  }
  const Component = plugin.component;
  return (
    <ErrorBoundary
      fallback={() => <p className="p-4 text-sm text-error">Plugin “{plugin.id}” failed to render.</p>}
    >
      <Component />
    </ErrorBoundary>
  );
}
