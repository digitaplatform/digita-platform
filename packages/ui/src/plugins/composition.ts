import type { Audience } from '@digitaplatform/shared';
import { loadPluginsFromManifest, setLayoutConfig } from '@/plugins/registry';
import { getPluginManifest } from '@/services/plugins';
import { defaultLayout } from '@/config/layout';
import { resolveTemplate } from '@/templates/template-registry';

/**
 * Load the app's plugin composition (which plugins to load + their placement) and
 * apply the layout. Used BOTH at boot (when already authenticated) and after an
 * in-app login — the latter is why this is a standalone helper: the anonymous boot
 * runs before any user exists, so the composition must be (re)loaded once the
 * session authenticates (otherwise the nav region stays empty until a full reload).
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
    const res = await getPluginManifest();
    if (res.success && res.data) {
      await loadPluginsFromManifest(res.data.plugins);
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
