import type { TemplateDefinition } from '@digitaplatform/plugins';
import { templateDefinitions } from './definitions';

/**
 * Registry of declarative shell layouts. Built-in authored configs register at
 * boot; a future designer/backend would registerTemplate() served definitions
 * the same way — data, not code. Mirrors the plugin registry pattern.
 */
const templates = new Map<string, TemplateDefinition>();

/**
 * Register a template definition. Validation is ALWAYS on (not dev-gated) so a
 * bad config fails loud in production too — the same validator a future designer
 * runs before saving.
 */
export function registerTemplate(def: TemplateDefinition): void {
  const mains = def.regions.filter((r) => r.side === 'main');
  if (mains.length !== 1) {
    throw new Error(
      `[templates] "${def.id}" must declare exactly one side:'main' region (got ${mains.length}).`,
    );
  }
  const ids = new Set<string>();
  for (const r of def.regions) {
    if (ids.has(r.id)) throw new Error(`[templates] "${def.id}" has a duplicate region id "${r.id}".`);
    ids.add(r.id);

    // Reject mobile behaviors the single renderer cannot realize, rather than
    // silently mispainting them (fail-loud, per the no-silent-fallbacks rule —
    // and the same validator a future designer runs before saving).
    if ((r.side === 'top' || r.side === 'bottom') && (r.mobile === 'drawer' || r.mobile === 'collapse')) {
      throw new Error(
        `[templates] "${def.id}" region "${r.id}": mobile:"${r.mobile}" is not supported on a ${r.side} bar (use 'static' or 'hidden').`,
      );
    }
    if (r.mobile === 'collapse') {
      throw new Error(
        `[templates] "${def.id}" region "${r.id}": mobile:"collapse" is reserved and not yet wired in the renderer.`,
      );
    }
  }
  templates.set(def.id, def);
}

/**
 * Resolve the active definition by id; throw loudly if unknown — NO silent
 * fallback to 'classic' (a typo must surface, not mispaint).
 */
export function resolveTemplate(id: string): TemplateDefinition {
  const def = templates.get(id);
  if (!def) {
    throw new Error(
      `[templates] unknown template "${id}". Registered: ${[...templates.keys()].join(', ') || '(none)'}.`,
    );
  }
  return def;
}

/** Register the built-in authored definitions. Idempotent; called once at boot. */
export function registerBuiltinTemplates(): void {
  for (const def of templateDefinitions) registerTemplate(def);
}
