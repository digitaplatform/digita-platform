import type { Signature } from './index.js';

/**
 * RUNTIME signature registry — signatures that arrive at runtime as SIGNATURE
 * PLUGINS (pure identity config delivered via the plugin inventory), as opposed
 * to any signature BAKED into the theme. Framework-agnostic (no React): a plain
 * snapshot + subscribe pair, consumable by useSyncExternalStore or any reactive
 * layer.
 *
 * getSignature() consults this registry FIRST, so a runtime-loaded signature's
 * full brand world (accent + fonts + colours + graphics + monogram + wordmark)
 * is what applySignature() writes and what the shell chrome reads — even though
 * it has no baked entry.
 */
const registered = new Map<string, Signature>();
const listeners = new Set<() => void>();

// Stable snapshot reference — replaced only on an actual change, so
// useSyncExternalStore consumers don't loop.
let snapshot: readonly Signature[] = [];

/** Register (or replace) a runtime-loaded signature by id, then notify. Called by
 *  the host's signature-plugin handler after the composition delivers it. */
export function registerSignature(sig: Signature): void {
  registered.set(sig.id, sig);
  snapshot = [...registered.values()];
  for (const listener of [...listeners]) listener();
}

/** Look up one runtime-registered signature by id (undefined if absent). */
export function getRuntimeSignature(id: string | null | undefined): Signature | undefined {
  return id != null ? registered.get(id) : undefined;
}

/** Reactive snapshot of every runtime-registered signature (stable reference). */
export function getRuntimeSignatures(): readonly Signature[] {
  return snapshot;
}

/** Subscribe to registry changes; returns the unsubscribe fn (useSyncExternalStore-compatible). */
export function subscribeRuntimeSignatures(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
