import { api } from '@/services/api';
import type { ApiResponse } from '@digitaplatform/shared';
import type { LayoutConfig, PluginTier, PluginType, SignatureValue } from '@digitaplatform/plugins';

/** One plugin the app's COMPOSITION enables (from the merged plugins.config.json).
 *  The engine sends only { id, title? } — the load data (type/tier/URL) comes from
 *  the inventory join (see plugins/composition.ts). Older engines also inlined a
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

export function getPluginManifest(): Promise<ApiResponse<PluginManifest>> {
  return api.get<ApiResponse<PluginManifest>>('/api/v1/plugins');
}

/** One entry of the static plugin INVENTORY (/plugins/index.json, emitted by the
 *  staging step): everything STAGED for this deployment — typed + tiered, with
 *  the version-addressed artifact URL. Free entries point at the open static
 *  path (/plugins/<id>/<ver>/<entry>); premium entries at the engine-gated
 *  streaming route (/api/v1/plugin-assets/<id>/<ver>/<entry>). */
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

/** Fetch the static inventory. Same-origin static JSON — a plain fetch, not the
 *  api client (no ApiResponse envelope, no auth/CSRF involved). Fail-SOFT null
 *  (logged): without an inventory the host still runs legacy compositions
 *  (inline bundle urls / the dev workspace source glob). */
export async function getPluginInventory(): Promise<PluginInventory | null> {
  try {
    const res = await fetch('/plugins/index.json', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const inventory = (await res.json()) as PluginInventory;
    if (!Array.isArray(inventory.plugins)) throw new Error('malformed inventory: no "plugins" array');
    return inventory;
  } catch (err) {
    console.error('[plugins] inventory /plugins/index.json unavailable — typed/premium loading disabled', err);
    return null;
  }
}
