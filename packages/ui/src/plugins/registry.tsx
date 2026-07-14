import type {
  ComponentPlugin,
  DesignPlugin,
  DigitaPlugin,
  FrontendPlugin,
  LayoutConfig,
  PluginManifestEntry,
  PluginType,
  SignaturePlugin,
} from '@digitaplatform/plugins';
import { isDigitaPlugin } from '@digitaplatform/plugins';
import { ErrorBoundary } from '@digitaplatform/components';
import { applyBranding, applyDesign, registerDesign } from '@digitaplatform/theme';
import { usePluginLayoutStore } from '@/stores/plugin-state';

// COMPONENT plugins loaded for this session (design plugins live in the theme's
// runtime design registry — only components render into Regions). Two ways in:
// BUILT-IN first-party plugins (builtins.ts) call registerPlugin() directly at
// boot — their source is compiled into the host bundle; everything else is
// app-provided and loaded at runtime from the composition. The rest is identical.
const loaded = new Map<string, FrontendPlugin>();

// Premium plugin ids the tenant is NOT entitled to (per /api/v1/plugins
// entitlements). Locked = its bytes are never fetched; a Region placing one
// explains WHY instead of the generic "not loaded" error.
const locked = new Set<string>();

export function registerPlugin(plugin: FrontendPlugin): void {
  loaded.set(plugin.id, plugin);
}

/** Replace the locked set for this composition load (composition.ts calls it on
 *  every (re)load, so a post-login license can unlock what boot locked). */
export function setLockedPlugins(ids: string[]): void {
  locked.clear();
  for (const id of ids) locked.add(id);
}

export function isPluginLocked(id: string): boolean {
  return locked.has(id);
}

// Dev only: load PREMIUM plugin implementations from their sibling-repo SOURCE so
// the whole app is ONE Vite module graph — a single React instance + a single
// @digitaplatform/plugins host-services singleton, plus hot-reload of plugin edits. The
// built /public ESM bundle (the prod federation path) can't be import()ed as a
// module by the dev server AND would pull a second React. The glob is statically
// extracted by Vite but the import.meta.env.DEV guard tree-shakes it (and the
// plugin sources) out of the production build, which keeps using the manifest URL.
// (First-party FREE plugins need no dev glob — they are BUILT-IN workspace
// packages registered at boot by builtins.ts, in dev and prod alike.)
const devPluginSources: Record<string, () => Promise<unknown>> = import.meta.env.DEV
  ? import.meta.glob(['../../../../../digita-plugins/*/src/index.tsx'])
  : {};

function devSourceLoader(id: string): (() => Promise<unknown>) | undefined {
  const key = Object.keys(devPluginSources).find((p) => p.includes(`/${id}/src/`));
  return key ? devPluginSources[key] : undefined;
}

/**
 * One plugin to load, as produced by the composition ⋈ inventory join
 * (plugins/composition.ts): the composition contributes id/title, the inventory
 * contributes type/url. Both may be absent for a dev-source-only plugin — the
 * workspace glob needs no URL and the module's own export carries the type.
 */
export interface PluginSource {
  id: string;
  title?: string;
  type?: PluginType;
  url?: string;
  /** signature only: identity config carried by the inventory entry itself. */
  accent?: string;
  fonts?: { display?: string; sans?: string; mono?: string };
  logoUrl?: string;
}

/** Normalize a dynamically-imported plugin module to a typed DigitaPlugin.
 *  Back-compat: a legacy FrontendPlugin export (no `type` discriminator) is a
 *  component plugin — wrapped here instead of forcing every plugin to migrate. */
function normalizeModulePlugin(mod: unknown, id: string): DigitaPlugin | null {
  const m = mod as { plugin?: unknown; default?: unknown };
  const exported = m.plugin ?? m.default;
  if (isDigitaPlugin(exported)) return exported;
  const legacy = exported as FrontendPlugin | undefined;
  if (legacy && typeof legacy === 'object' && typeof legacy.id === 'string' && legacy.component) {
    return { ...legacy, type: 'component' };
  }
  console.error(`[plugins] "${id}" exposes no plugin/default export`);
  return null;
}

// ─── Type-dispatch handler table ───────────────────────────────────────────
// Each handler INTEGRATES one typed plugin into the host. Both load paths (dev
// workspace source and inventory URL) converge here, so a plugin behaves
// identically however it arrived.

type IntegrateHandlers = { [P in DigitaPlugin as P['type']]: (plugin: P) => void | Promise<void> };

const integrateHandlers: IntegrateHandlers = {
  // component: today's behaviour, unchanged semantics — register, the layout's
  // Region renders it (error-boundaried).
  component: (plugin: ComponentPlugin) => {
    registerPlugin(plugin);
  },
  // design: inject the same-origin stylesheet, then register {designId, variant}
  // with the theme so applyDesign()/data-design + the DesignMenu work for it.
  design: async (plugin: DesignPlugin) => {
    await injectDesignStylesheet(plugin);
    registerDesign(plugin.designId, plugin.variant, { name: plugin.title ?? plugin.designId });
    // If this design is the ACTIVE one (persisted pick applied at boot, before
    // the plugin loaded), the variant stamp was resolved without the registry —
    // re-apply so data-design-variant reflects the now-registered variant.
    if (document.documentElement.getAttribute('data-design') === plugin.designId) {
      applyDesign(plugin.designId);
    }
  },
  // signature: an IDENTITY overlay (accent + fonts) applied via the BRANDING
  // layer (inline --color-primary-* / --font-* vars). CRITICAL: it never touches
  // data-design — a signature COMPOSES on top of whatever design skin is active,
  // so flipping the design keeps the signature and vice versa.
  signature: (plugin: SignaturePlugin) => {
    applyBranding({ primary_color: plugin.accent ?? null, fonts: plugin.fonts });
    // TODO(plugin.logoUrl): swap the shell's logo chrome (header/sidebar brand
    // slot) to the signature's logo once the shell exposes that slot.
  },
};

async function integratePlugin(plugin: DigitaPlugin): Promise<void> {
  const handler = integrateHandlers[plugin.type] as (p: DigitaPlugin) => void | Promise<void>;
  await handler(plugin);
}

/** Idempotent stylesheet injection for a design plugin (marker: the
 *  data-design-plugin attribute). Resolves once the CSS is loaded; on a load
 *  failure the dead link is removed and the promise rejects, so a broken design
 *  never registers in the picker. */
function injectDesignStylesheet(plugin: DesignPlugin): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.head.querySelector(`link[data-design-plugin="${CSS.escape(plugin.designId)}"]`)) {
      resolve();
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = plugin.cssUrl;
    link.setAttribute('data-design-plugin', plugin.designId);
    link.onload = () => resolve();
    link.onerror = () => {
      link.remove();
      reject(new Error(`stylesheet failed to load: ${plugin.cssUrl}`));
    };
    document.head.appendChild(link);
  });
}

/**
 * Resolve one plugin source to its typed runtime object. The dev workspace
 * source wins whatever the declared type — it must yield the same DigitaPlugin
 * shape the handlers consume. Otherwise the TYPE decides: 'design' needs no
 * module at all (the inventory URL IS the artifact — a same-origin CSS file);
 * 'component' is a dynamic ESM import (`@vite-ignore` — a runtime remote, not a
 * build input) with React + the shared singletons resolved via the host's
 * import-map so plugin components compose with the host's React tree.
 */
async function resolvePlugin(source: PluginSource): Promise<DigitaPlugin | null> {
  const devLoader = devSourceLoader(source.id);
  if (devLoader) return normalizeModulePlugin(await devLoader(), source.id);
  if (source.type === 'signature') {
    // A signature is pure CONFIG — no module to import, no CSS to inject, no
    // URL needed. The inventory/source entry itself carries everything the
    // handler applies (accent + fonts + logoUrl).
    return {
      type: 'signature',
      id: source.id,
      title: source.title,
      accent: source.accent,
      fonts: source.fonts,
      logoUrl: source.logoUrl,
    };
  }
  if (!source.url || !source.type) {
    console.error(`[plugins] "${source.id}" has no inventory entry (and no dev source) — cannot load`);
    return null;
  }
  if (source.type === 'design') {
    // Inventory schemaVersion 1 carries no designId/variant, so both derive from
    // the plugin id — every shipped design plugin declares meta.variant === id
    // (its dist/digita-plugin.json agrees). When a design whose variant differs
    // from its id ships, the inventory gains explicit designId/variant fields.
    return {
      type: 'design',
      id: source.id,
      title: source.title,
      designId: source.id,
      variant: source.id,
      cssUrl: source.url,
    };
  }
  return normalizeModulePlugin(await import(/* @vite-ignore */ source.url), source.id);
}

/**
 * Load + integrate every plugin of the composition ⋈ inventory join, each by its
 * TYPE via the handler table. Per-plugin fail-soft: one broken plugin logs and is
 * skipped; the rest of the shell keeps working.
 */
export async function loadPlugins(sources: PluginSource[]): Promise<void> {
  await Promise.all(
    sources.map(async (source) => {
      try {
        // A composition may still list a BUILT-IN plugin id (placement is the
        // layout's business, not the loader's). Built-ins registered at boot
        // (builtins.ts) need no loading — skip instead of erroring on a source
        // that has, by design, no inventory entry and no dev glob hit.
        if (loaded.has(source.id)) return;
        const plugin = await resolvePlugin(source);
        if (plugin) await integratePlugin(plugin);
      } catch (err) {
        console.error(
          `[plugins] failed to load "${source.id}"${source.url ? ` from ${source.url}` : ''}`,
          err,
        );
      }
    }),
  );
}

/** Legacy manifest loader — entries whose `url` is a component ESM bundle (the
 *  pre-inventory engine shape). Kept working for back-compat; delegates to the
 *  typed path as component plugins. */
export async function loadPluginsFromManifest(entries: PluginManifestEntry[]): Promise<void> {
  await loadPlugins(entries.map((e) => ({ id: e.id, title: e.title, type: 'component' as const, url: e.url })));
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
 * loudly rather than a silently empty region — except a LOCKED premium plugin
 * (not entitled), which is an expected state and shown as such. A render error
 * in the plugin is contained by an error boundary so it can't crash the whole shell.
 */
export function Region({ name }: { name: string }) {
  // Reactive read so the region paints as soon as the composition loads (post-login).
  const id = usePluginLayoutStore((s) => s.layout.regions[name]);
  if (!id) return null; // nothing placed here — fine
  const plugin = loaded.get(id);
  if (!plugin) {
    if (locked.has(id)) {
      return (
        <p className="p-4 text-sm text-textMuted">
          Plugin “{id}” is a premium plugin this tenant is not licensed for.
        </p>
      );
    }
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
