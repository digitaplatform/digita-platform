import appMenu from './app-menu';
import { registerPlugin } from './registry';

/**
 * BUILT-IN first-party plugins.
 *
 * They are compiled from the app's own source into the host bundle — one Vite
 * module graph, one React — and registered here at module load, i.e. at boot
 * BEFORE the shell renders. No vite bundle, no runtime import(), no staging, no
 * inventory entry. Premium plugins, by contrast, keep loading at runtime from the
 * staged inventory (composition.ts → registry.tsx), gated by license entitlements.
 *
 * This module is imported ONCE, for its side effect, at app boot (main.tsx) —
 * analogous to how stores/theme.ts applies the persisted theme at module load.
 * A composition that still lists a built-in id is harmless: loadPlugins skips
 * ids that are already registered.
 */
registerPlugin(appMenu);
