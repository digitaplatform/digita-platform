import type { TemplateDefinition } from '@digitaplatform/plugins';

/**
 * Built-in shell layouts as PURE DATA. A template is config, not code: the one
 * generic ShellRenderer paints any of these. A future visual Template-Designer
 * would produce objects of exactly this shape (see @digitaplatform/plugins
 * TemplateDefinition). No plugin is named here — placement lives in LayoutConfig.
 */

// CLASSIC — the daily-driver shell: a LEFT rail with brand chrome that collapses
// on desktop and becomes an overlay drawer on mobile, plus the routed main
// region. This single object replaces all the bespoke JSX that used to live in
// ClassicSidebarTemplate.tsx.
export const classicTemplate: TemplateDefinition = {
  id: 'classic',
  name: 'Classic sidebar',
  version: 1,
  regions: [
    {
      id: 'left',
      side: 'left',
      order: 0,
      size: { desktop: 'w-72', mobile: 'w-16' },
      brand: true,
      collapsible: true,
      mobile: 'drawer',
      label: 'Primary navigation',
    },
    { id: 'main', side: 'main' },
    // Add a right rail with zero code: append { id:'right', side:'right',
    // size:{desktop:'w-72'}, mobile:'drawer' } and place a plugin via
    // LayoutConfig.regions.right.
  ],
};

// TOPBAR — a structural PROOF that a new template is pure config: the SAME
// renderer, only the definition changes. Brand chrome + a placed nav plugin live
// in a top bar; the page fills the rest. CAVEAT: the host utility bar (Topbar:
// theme/user/sign-out) is fixed host chrome that renders above main in EVERY
// template, so activating this template currently shows TWO stacked bars. A real
// horizontal-nav template would need host chrome to become a placeable region
// (deferred); until then this is a registered config-shape proof, not an
// end-to-end shipping template.
export const topbarTemplate: TemplateDefinition = {
  id: 'topbar',
  name: 'Top bar',
  version: 1,
  regions: [
    {
      id: 'top',
      side: 'top',
      order: 0,
      size: { desktop: 'h-14' },
      brand: true,
      mobile: 'static',
      label: 'Top navigation',
    },
    { id: 'main', side: 'main' },
  ],
};

export const templateDefinitions: TemplateDefinition[] = [classicTemplate, topbarTemplate];
