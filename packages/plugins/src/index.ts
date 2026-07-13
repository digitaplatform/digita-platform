import type { ComponentType } from 'react';

/**
 * A frontend plugin — a self-contained widget the host places into a template
 * region. The host knows NOTHING about what a plugin does (menu, dashboard,
 * notifications, …); a plugin fetches its own backend data and renders itself.
 * Built and shipped by an app (digita-apps/<app>/plugins), loaded by the host
 * at runtime; identified by a stable `id` the layout config references.
 *
 * NOTE: a plugin placed in a drawer-mode rail mounts TWICE on mobile — a
 * persistent desktop instance and a per-open drawer instance that remounts on
 * each open. Don't assume a single instance or that drawer-local component state
 * survives across opens; keep shared state in the host (via useHost) or a store.
 */
export interface FrontendPlugin {
  id: string;
  title?: string;
  component: ComponentType;
}

/** The expected shape of a dynamically-imported plugin ESM module. */
export interface PluginModule {
  default?: FrontendPlugin;
  plugin?: FrontendPlugin;
}

/** One entry of the plugin manifest the engine serves (GET /api/v1/plugins). */
export interface PluginManifestEntry {
  id: string;
  /** URL of the plugin's ESM bundle, loaded at runtime via import(). */
  url: string;
  title?: string;
}

/**
 * Placement config — maps each template region id to a plugin id. The template
 * (a TemplateDefinition, resolved by `template` via the host's template
 * registry) owns WHERE a region docks; this owns WHICH plugin fills it. Data,
 * not code (served per app/tenant), so placement is config-driven.
 */
export interface LayoutConfig {
  template: string;
  regions: Record<string, string>;
}

// ─── Typed plugin contract (v2, additive) ─────────────────────────────────
// A plugin declares its TYPE (how the host integrates it) and its TIER (whether a
// tenant may use it) — orthogonal axes. These are added ALONGSIDE the legacy
// FrontendPlugin / PluginManifestEntry above; consumers migrate incrementally.

/** How the host integrates a plugin — the discriminator every stage dispatches on.
 *  Reserved values are declared now, handled when the first plugin of that type ships. */
export type PluginType = 'component' | 'design';
// reserved (future): 'data-source' | 'report' | 'workflow' | 'entity-pack'

/** Commercial tier. Orthogonal to type: gates staging + activation, never integration. */
export type PluginTier = 'community' | 'premium';

/** A component plugin — today's FrontendPlugin, now carrying its discriminator. */
export interface ComponentPlugin {
  type: 'component';
  id: string;
  title?: string;
  component: ComponentType; // rendered into a template Region, error-boundaried
}

/** A design plugin — a pure-CSS look applied via <html data-design>. Ships no React. */
export interface DesignPlugin {
  type: 'design';
  id: string;
  title?: string;
  designId: string; // value written to the data-design attribute
  cssUrl: string; // same-origin, version-addressed stylesheet URL
}

/** The discriminated set of runtime plugin objects — grows one member per type. */
export type DigitaPlugin = ComponentPlugin | DesignPlugin;

/** The `digita` manifest a plugin package ships (package.json block + dist/digita-plugin.json).
 *  Read by the build-time staging step and validated in CI. */
export interface PluginPackageManifest {
  /** Stable slug — drives folder, package name @digitaplatform/<id>, served path, manifest id. */
  id: string;
  type: PluginType;
  tier: PluginTier;
  /** Semver range of @digitaplatform/plugins this artifact was built against. */
  sdk: string;
  /** Primary artifact inside dist/ (component: the ESM file, design: the CSS file). */
  entry: string;
  displayName: string;
  /** Premium only: which offer/SKU sells it. */
  sku?: string;
}

/** One entry of the TYPED per-tenant manifest the engine serves — coexists with the
 *  legacy PluginManifestEntry during migration. */
export type TypedPluginManifestEntry =
  | { type: 'component'; id: string; version: string; tier: PluginTier; title?: string; url: string }
  | { type: 'design'; id: string; version: string; tier: PluginTier; title?: string; designId: string; cssUrl: string };

/** Runtime narrowing guard for a dynamically-imported module's plugin export. */
export function isDigitaPlugin(v: unknown): v is DigitaPlugin {
  if (!v || typeof v !== 'object' || !('type' in v)) return false;
  const t = (v as { type: unknown }).type;
  return t === 'component' || t === 'design';
}

// ─── Template definitions (declarative shell layout) ──────────────────────
// A TemplateDefinition is PURE DATA: which regions exist, where each docks, its
// size/chrome/collapse, and its responsive behavior. The host ships a single
// generic shell renderer that paints any definition — new templates are new
// CONFIG, not new components. The host renderer, the hand-authored config
// files, and a future visual Template-Designer all speak THIS contract, so it
// lives in the SDK. NO plugin is named here; placement (which plugin fills a
// region) lives in LayoutConfig.regions.

/** Edge a region docks to. 'main' IS the routed page (React Router <Outlet/>). */
export type RegionSide = 'left' | 'right' | 'top' | 'bottom' | 'main';

/**
 * How a docked rail/bar behaves below the host's `lg` breakpoint. Declarative —
 * the renderer interprets it; nothing is hardcoded per template.
 *  - 'drawer'  : hidden at <lg; opens as an overlay from its side (driven by the
 *                host's mobileNavOpen flag). Default for left/right rails. Rails
 *                only.
 *  - 'hidden'  : removed below the breakpoint.
 *  - 'static'  : unchanged across breakpoints. Default for top/bottom bars.
 *  - 'collapse': RESERVED — intended to stay docked and narrow to `size.mobile`
 *                below `lg`, but NOT yet wired in the renderer. The template
 *                registry rejects it (fail-loud) until implemented.
 * Wired today: 'drawer' | 'hidden' | 'static'. Top/bottom bars support only
 * 'static' | 'hidden' (the registry rejects 'drawer'/'collapse' on a bar). A
 * 'sheet' value is also deferred (additive, non-breaking) until a template needs it.
 */
export type RegionMobileBehavior = 'drawer' | 'collapse' | 'hidden' | 'static';

/**
 * Region size as LITERAL Tailwind class tokens (so the JIT scans them at build).
 * `desktop` is the docked extent (`w-*` for left/right, `h-*` for top/bottom);
 * `mobile` applies only when collapsed. Ignored for side:'main' (it flexes).
 * Author literal tokens ('w-72', 'w-16', 'h-14') — never runtime-interpolated
 * classes (those get purged by Tailwind).
 */
export interface RegionSize {
  desktop: string;
  mobile?: string;
}

/**
 * One region of the shell. The plugin that fills it is chosen by
 * LayoutConfig.regions[id]; this object describes only the FRAME (where/how).
 */
export interface RegionDefinition {
  /** Stable region id LayoutConfig.regions keys on (e.g. 'left','main','top'). */
  id: string;
  side: RegionSide;
  /** Deterministic paint order within a side (low first); defaults to array order. */
  order?: number;
  /** Sizing; omit for side:'main' (it flexes to fill). */
  size?: RegionSize;
  /** Render brand chrome (logo + app name) as a header inside this region. */
  brand?: boolean;
  /** User can collapse/expand this rail on desktop. */
  collapsible?: boolean;
  /** Responsive behavior; renderer defaults: left/right → 'drawer', else 'static'. */
  mobile?: RegionMobileBehavior;
  /** a11y / designer-facing display name. */
  label?: string;
}

/**
 * A complete shell layout as data. Designer-serializable: id + version +
 * ordered regions, lossless JSON round-trip (no functions, no JSX, no plugin
 * names). Exactly one region MUST have side:'main' (the routed Outlet); the
 * host's template registry fails loud otherwise.
 */
export interface TemplateDefinition {
  /** Stable id LayoutConfig.template references (e.g. 'classic','topbar'). */
  id: string;
  /** Human/designer display name. */
  name?: string;
  /** Schema version for forward-compat migration by a future designer tool. */
  version: number;
  regions: RegionDefinition[];
}

// ─── Host services (dependency injection) ─────────────────────────────────
// Plugins never import host internals. The host injects its runtime services
// once at boot via provideHostServices(); plugins read them via useHost(). At
// runtime, react / react-router / @tanstack/react-query are shared singletons
// (import-map), so plugin components compose with the host's React tree.

export interface HostApi {
  get<T>(url: string, params?: Record<string, string | number | boolean | undefined | null>): Promise<T>;
  post<T>(url: string, body?: unknown): Promise<T>;
  put<T>(url: string, body?: unknown): Promise<T>;
  del<T>(url: string): Promise<T>;
}

export interface HostSessionUser {
  _id: string;
  email: string;
  full_name?: string;
  language?: string;
  roles: string[];
}

/** The capabilities the host exposes to every plugin. */
export interface HostServices {
  /** HTTP client (cookie session + CSRF handled by the host). */
  api: HostApi;
  /** Current session user (null if not loaded). */
  getUser(): HostSessionUser | null;
  /** Translate a platform i18n key. */
  t(key: string, params?: Record<string, string | number>): string;
  /** Ask the host to close any open mobile nav drawer (after navigation). */
  closeMobileNav(): void;
}

let host: HostServices | null = null;

/** Called once by the host at boot, before any plugin renders. */
export function provideHostServices(services: HostServices): void {
  host = services;
}

/** Plugins read host capabilities here. Throws if the host hasn't provided them. */
export function useHost(): HostServices {
  if (!host) throw new Error('Host services are not available — provideHostServices() was not called.');
  return host;
}
