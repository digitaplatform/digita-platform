/**
 * RUNTIME design registry — designs that arrive at runtime as DESIGN PLUGINS
 * (a same-origin CSS artifact injected by the host), as opposed to the designs
 * BAKED into theme.css (designs/index.ts). Framework-agnostic (no React): a
 * plain snapshot + subscribe pair, directly consumable by React's
 * useSyncExternalStore or any other reactive layer.
 *
 * applyDesign() consults this registry so a runtime-loaded design stamps the
 * correct `data-design-variant` (its component-variant CSS layer) even though
 * it has no entry in the baked DESIGNS record.
 */

/** One runtime-registered design: the `data-design` id + its component-variant
 *  family, plus optional picker-facing labels. */
export interface RuntimeDesign {
  /** Value written to the `data-design` attribute (stable slug, never renamed). */
  designId: string;
  /** Value written to `data-design-variant` (the component-variant CSS layer). */
  variant: string;
  /** Picker display name (falls back to designId in UIs). */
  name?: string;
  /** Picker description line. */
  description?: string;
}

const registered = new Map<string, RuntimeDesign>();
const listeners = new Set<() => void>();

// Stable snapshot reference — only replaced on an actual change, so
// useSyncExternalStore consumers don't re-render (or loop) on every read.
let snapshot: readonly RuntimeDesign[] = [];

/**
 * Register a runtime-loaded design (idempotent by designId — re-registering an
 * identical entry is a no-op, so repeated composition loads don't re-notify).
 * The caller (the host's design plugin handler) injects the CSS; this only
 * records the {designId, variant} mapping + picker metadata and notifies
 * subscribers.
 */
export function registerDesign(
  designId: string,
  variant: string,
  meta?: { name?: string; description?: string },
): void {
  const next: RuntimeDesign = { designId, variant, name: meta?.name, description: meta?.description };
  const existing = registered.get(designId);
  if (
    existing &&
    existing.variant === next.variant &&
    existing.name === next.name &&
    existing.description === next.description
  ) {
    return;
  }
  registered.set(designId, next);
  snapshot = [...registered.values()];
  for (const listener of [...listeners]) listener();
}

/** Reactive snapshot of every runtime-registered design (stable reference —
 *  safe as a useSyncExternalStore getSnapshot). */
export function getRuntimeDesigns(): readonly RuntimeDesign[] {
  return snapshot;
}

/** Lookup one runtime-registered design by its designId (undefined if absent). */
export function getRuntimeDesign(designId: string): RuntimeDesign | undefined {
  return registered.get(designId);
}

/** Subscribe to registry changes; returns the unsubscribe function
 *  (useSyncExternalStore-compatible). */
export function subscribeRuntimeDesigns(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
