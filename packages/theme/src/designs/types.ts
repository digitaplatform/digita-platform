import type { SemanticTokens } from '../tokens/semantic.js';
import type { ColorRamp } from '../tokens/palettes.js';

/** Human-facing identity of a design — the data source for a generic picker.
 *  `id` is a stable slug (→ the `data-design` attribute value + localStorage);
 *  NEVER rename it once shipped. */
export interface DesignMeta {
  id: string;
  name: string;
  description: string;
  /** Component-variant family. `default` (or omitted) renders the base
   *  primitives; every other value opts the primitives into a design-language
   *  variant layer (build/variants/<variant>.css, scoped to
   *  `[data-design-variant="<variant>"]`). Additive — primitives default to
   *  `default`. */
  variant?: 'default' | 'material' | 'ios' | 'editorial' | 'fluent' | 'minimal';
}

/**
 * A DESIGN is a named bundle of token values — the plugin unit of the theming
 * system. Colors are mandatory (a design IS a palette); every other facet is
 * optional and falls back to the platform scale defaults, so a minimal design is
 * "just colors". gen-css emits each design into a `:root[data-design="<id>"]`
 * scope; runtime `applyDesign(id)` flips the attribute. Nothing design-specific
 * lives outside `designs/<id>/` — that is the whole point.
 */
export interface Design {
  meta: DesignMeta;

  /** REQUIRED — the full semantic set for BOTH modes. */
  semantic: { light: SemanticTokens; dark: SemanticTokens };

  /**
   * REQUIRED — the categorical / identity palette: exactly 8 distinct hues per
   * mode, used to colour-tag things by BELONGING (report collections, chart
   * series), NOT by status. Kept separate from the status colours (warning/error)
   * on purpose. Each design supplies its OWN idiomatic 8 (no silent platform
   * default — identity colour is a design decision); gen-css derives the `-soft`
   * tints. Emitted as --color-cat-1..8 (+ -soft).
   */
  categorical: { light: string[]; dark: string[] };

  /** Optional ramp overrides. Omitted → the platform default NEUTRAL/ACCENT
   *  ramps. The PRIMARY ramp is deliberately NOT here (ADR-V2): the tint layer
   *  owns it — a design controls everything EXCEPT the tint. Tenant branding
   *  still overrides primary/accent at runtime. */
  ramps?: { neutral?: ColorRamp; accent?: ColorRamp };

  /** Optional element-class radii. Omitted keys inherit the platform scale. */
  radius?: Partial<Record<'input' | 'btn' | 'card' | 'dialog', string>>;

  /** Optional per-mode shadow overrides (same keys as scales.shadowValues). */
  shadow?: { light?: Record<string, string>; dark?: Record<string, string> };

  /** Optional font stacks — emitted as --font-* vars the preset reads. */
  typography?: { sans?: string[]; display?: string[]; mono?: string[] };

  /** Optional motion overrides (same keys as scales.motionValues). */
  motion?: Record<string, string>;

  /** Optional density-scale overrides (the --density-* triples). */
  density?: Partial<
    Record<'comfortable' | 'compact' | 'spacious', { pad: string; gap: string; row: string }>
  >;
}
