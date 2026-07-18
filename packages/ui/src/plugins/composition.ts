import type { Audience } from '@digitaplatform/shared';
import { loadPlugins, setLayoutConfig, setLockedPlugins } from '@/plugins/registry';
import type { PluginSource } from '@/plugins/registry';
import { getPluginInventory, getPluginManifest } from '@/services/plugins';
import type { CompositionPluginEntry, PluginInventory } from '@/services/plugins';
import { defaultLayout } from '@/config/layout';
import { resolveTemplate } from '@/templates/template-registry';

/**
 * Join the engine COMPOSITION (which plugins this app enables — /api/v1/plugins)
 * with the static INVENTORY (what is staged: type + tier + version-addressed URL
 * — /plugins/index.json) by id. `entitlements` (the entitled premium ids from
 * the verified license) gate premium entries: a premium id NOT entitled is
 * LOCKED — skipped entirely, its bytes never fetched (Region shows it as locked).
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
      // source glob; otherwise the registry logs the miss loudly.
      sources.push({ id: entry.id, title: entry.title });
    }
  }
  return { sources, lockedIds };
}

/**
 * Load the app's plugin composition (which plugins to load + their placement) and
 * apply the layout. Used BOTH at boot (when already authenticated) and after an
 * in-app login — the latter is why this is a standalone helper: the anonymous boot
 * runs before any user exists, so the composition must be (re)loaded once the
 * session authenticates (otherwise the nav region stays empty until a full reload).
 *
 * Fetches BOTH the composition ({plugins, layout, entitlements}) and the static
 * inventory in parallel, joins them by id, and drives the registry's typed
 * loader ('component' → ESM import via the import-map federation, 'design' →
 * stylesheet injection + theme design registry).
 *
 * Template resolution order (F1): manifest layout → BrandingSetting.default_template
 * → the hard fallback defaultLayout (warned, never silent). Fail-SOFT on a missing
 * manifest (logs; the shell keeps the fallback layout). `resolveTemplate` still
 * throws on an UNKNOWN template id — the caller decides whether that's fatal (boot)
 * or swallowed (post-login).
 *
 * `audience` (ADR-A3) is threaded through this single composition funnel. Today the
 * only wired SPA runtime is `internal`, for which the manifest's top-level `layout`
 * key IS the internal composition (roadmap line 205: layout ≡ audiences.internal).
 * TODO(P5): when portal/marketing TemplateDefinitions ship, select the per-audience
 * template from the /boot audiences map for external/anonymous arms.
 */
export async function loadAppComposition(
  audience: Audience,
  brandingDefaultTemplate?: string,
): Promise<void> {
  void audience; // internal-only today; see TODO(P5) above.
  let layout = defaultLayout;
  try {
    const [res, inventory] = await Promise.all([getPluginManifest(), getPluginInventory()]);
    if (res.success && res.data) {
      const { sources, lockedIds } = joinCompositionWithInventory(
        res.data.plugins,
        inventory,
        res.data.entitlements ?? [],
      );
      setLockedPlugins(lockedIds);
      await loadPlugins(sources);
      if (res.data.layout) {
        layout = res.data.layout;
      } else if (brandingDefaultTemplate) {
        layout = { ...defaultLayout, template: brandingDefaultTemplate };
      } else {
        console.warn(
          '[boot] no manifest layout and no BrandingSetting.default_template — using hard fallback defaultLayout. Set BrandingSetting.default_template before production.',
        );
      }
    }
  } catch (e) {
    console.error('[boot] plugin manifest load failed — navigation may be unavailable', e);
  }
  setLayoutConfig(layout);
  resolveTemplate(layout.template); // fail loud on an unknown template id
}
