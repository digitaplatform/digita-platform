import type { DesignPlugin, LayoutConfig, PluginTier, PluginType, SignatureValue } from './index.js';

/** One plugin the app's COMPOSITION enables (from the merged plugins.config.json).
 *  The engine sends only { id, title? } — the load data (type/tier/URL) comes from
 *  the inventory join (joinCompositionWithInventory). Older engines also inlined a
 *  component bundle `url`; kept optional for back-compat with that path. */
export interface CompositionPluginEntry {
  id: string;
  title?: string;
  url?: string;
}

/** What the engine serves on GET /api/v1/plugins: the app COMPOSITION — which
 *  plugins this app enables + their opaque placement layout (both relayed from
 *  the app-declared plugins.config.json) + `entitlements`, the entitled PREMIUM
 *  plugin ids from the verified tenant license (empty/absent when there is no
 *  valid license). The engine does not interpret the layout — the host applies it. */
export interface PluginManifest {
  plugins: CompositionPluginEntry[];
  layout?: LayoutConfig;
  entitlements?: string[];
}

/** One entry of the static plugin INVENTORY (/plugins/index.json, emitted by the
 *  staging step): everything STAGED for this deployment — typed + tiered, with
 *  the version-addressed artifact URL. Free entries point at the open static
 *  path (/plugins/<id>/<ver>/<entry>); premium entries at the engine-gated
 *  streaming route (/api/v1/plugin-assets/<id>/<ver>/<entry>). Both are paths on
 *  the app that stages them. */
export interface PluginInventoryEntry {
  id: string;
  type: PluginType;
  tier: PluginTier;
  version: string;
  /** component/design: the artifact filename + its URL + integrity. ABSENT for
   *  signatures, which are pure config with no artifact to fetch. */
  entry?: string;
  integrity?: string;
  url?: string;
  /** signature only: identity config inlined in the inventory (a signature is
   *  pure config — no artifact beyond these fields). A thin signature carries
   *  accent + fonts (+ monogram); a FULL signature also carries the brand colour
   *  world + decorative graphics + wordmark. */
  accent?: string;
  fonts?: { display?: string; sans?: string; mono?: string };
  logoUrl?: string;
  monogram?: string;
  wordmark?: string;
  colors?: Record<string, SignatureValue>;
  graphics?: Record<string, SignatureValue>;
}

export interface PluginInventory {
  schemaVersion: number;
  plugins: PluginInventoryEntry[];
}

/** Fetch the static inventory an app stages (`<app base>/plugins/index.json`).
 *  Same-origin static JSON — a plain fetch (no ApiResponse envelope, no
 *  auth/CSRF involved). Fail-SOFT null (logged): without an inventory a host
 *  still runs legacy compositions (inline bundle urls / the dev workspace
 *  source glob). */
export async function findPluginInventory(url: string): Promise<PluginInventory | null> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const inventory = (await res.json()) as PluginInventory;
    if (!Array.isArray(inventory.plugins)) throw new Error('malformed inventory: no "plugins" array');
    return inventory;
  } catch (err) {
    console.error(`[plugins] inventory ${url} unavailable — typed/premium loading disabled`, err);
    return null;
  }
}

/** One plugin a host is to load: the composition entry joined with what the
 *  inventory stages for it. `url` is a path on the app that stages it. */
export interface PluginSource {
  id: string;
  title?: string;
  type?: PluginType;
  url?: string;
  /** signature only: identity config carried by the inventory entry itself. A
   *  thin signature carries accent + fonts (+ monogram); a FULL signature also
   *  carries the brand colour world + decorative graphics + wordmark. */
  accent?: string;
  fonts?: { display?: string; sans?: string; mono?: string };
  logoUrl?: string;
  monogram?: string;
  wordmark?: string;
  colors?: Record<string, SignatureValue>;
  graphics?: Record<string, SignatureValue>;
}

/**
 * Join the engine COMPOSITION (which plugins this app enables — /api/v1/plugins)
 * with the static INVENTORY (what is staged: type + tier + version-addressed URL
 * — /plugins/index.json) by id. `entitlements` (the entitled premium ids from
 * the verified license) gate premium entries: a premium id NOT entitled is
 * LOCKED — skipped entirely, its bytes never fetched (a host shows it as locked).
 * An id missing from the inventory falls back to the entry's legacy inline `url`
 * (pre-inventory engines) or, in dev, the workspace source glob (no url needed).
 */
export function joinCompositionWithInventory(
  compositionPlugins: CompositionPluginEntry[],
  inventory: PluginInventory | null,
  entitlements: string[],
): { sources: PluginSource[]; lockedIds: string[] } {
  const sources: PluginSource[] = [];
  const lockedIds: string[] = [];
  for (const entry of compositionPlugins) {
    const staged = inventory?.plugins.find((p) => p.id === entry.id);
    if (staged) {
      if (staged.tier === 'premium' && !entitlements.includes(entry.id)) {
        lockedIds.push(entry.id);
        continue;
      }
      sources.push({
        id: entry.id,
        title: entry.title,
        type: staged.type,
        url: staged.url,
        // signature only: identity config rides the inventory entry itself —
        // accent + fonts (+ monogram) for a thin signature, plus the full brand
        // colour world + graphics + wordmark for a full one (e.g. digita).
        accent: staged.accent,
        fonts: staged.fonts,
        logoUrl: staged.logoUrl,
        monogram: staged.monogram,
        wordmark: staged.wordmark,
        colors: staged.colors,
        graphics: staged.graphics,
      });
    } else if (entry.url) {
      // Legacy engine shape: the component bundle url inlined in the composition.
      sources.push({ id: entry.id, title: entry.title, type: 'component', url: entry.url });
    } else {
      // Not staged, no url: dev may still resolve the id from the workspace
      // source glob; otherwise the host's loader logs the miss loudly.
      sources.push({ id: entry.id, title: entry.title });
    }
  }
  return { sources, lockedIds };
}

/**
 * The design plugin a design source delivers, its stylesheet at `cssUrl` (the
 * source's `url` resolved on the app that stages it). Inventory schemaVersion 1
 * carries no designId/variant, so both derive from the plugin id — every shipped
 * design plugin declares meta.variant === id (its dist/digita-plugin.json
 * agrees). When a design whose variant differs from its id ships, the inventory
 * gains explicit designId/variant fields.
 */
export function designFromSource(source: PluginSource, cssUrl: string): DesignPlugin {
  return {
    type: 'design',
    id: source.id,
    title: source.title,
    designId: source.id,
    variant: source.id,
    cssUrl,
  };
}
