import type { LayoutConfig } from '@digitaplatform/plugins';

/**
 * LAST-RESORT fallback placement. Canonical placement is app-driven and comes
 * from the engine's plugin manifest — GET /api/v1/plugins → `manifest.layout`,
 * sourced from the app's plugins.config.json. This constant is used only when the
 * manifest omits a layout, and App.tsx warns when it falls back here — so
 * divergence is never silent. Keep it in sync with the app's intended default
 * (classic template, usermenu on the LEFT).
 */
export const defaultLayout: LayoutConfig = {
  template: 'classic',
  regions: {
    left: 'usermenu',
  },
};
