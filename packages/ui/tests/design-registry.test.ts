// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  DESIGN_LIST,
  DESIGNS,
  DEFAULT_DESIGN_ID,
  getDesign,
  applyDesign,
  resolveInitialDesign,
  registerDesign,
  getRuntimeDesign,
  getRuntimeDesigns,
  subscribeRuntimeDesigns,
} from '@digitaplatform/theme';

// Plugin-delivery flip: theme.css bakes ONLY the free default design (minimal).
// The four premium design languages (editorial/fluent/ios/material) are NOT in
// the baked registry anymore — they arrive at runtime as entitlement-gated
// design plugins (CSS artifact injected by the host + registerDesign() in the
// theme's runtime registry). NOTE: the runtime registry is module-global (no
// unregister), so these tests register only 'editorial'/'material' and keep
// 'fluent'/'ios' permanently UNregistered for the fall-through assertions.
describe('design registry + runtime', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-design');
    document.documentElement.removeAttribute('data-design-variant');
    localStorage.clear();
  });

  it('bakes ONLY the free default design (minimal); the premium four are not baked', () => {
    expect(DESIGN_LIST.map((d) => d.id)).toEqual(['minimal']);
    expect(DEFAULT_DESIGN_ID).toBe('minimal');
    // The premium design languages ship via the plugin delivery, never in theme.css.
    for (const premium of ['editorial', 'fluent', 'ios', 'material']) {
      expect(DESIGNS[premium]).toBeUndefined();
    }
  });

  it('every BAKED design defines all on-color tokens for both modes', () => {
    for (const d of Object.values(DESIGNS)) {
      for (const mode of ['light', 'dark'] as const) {
        expect(d.semantic[mode].onPrimary).toBeTruthy();
        expect(d.semantic[mode].onError).toBeTruthy();
      }
    }
  });

  it('applyDesign flips data-design; the DEFAULT design (minimal) removes it (bare :root)', () => {
    // A non-default id is written VERBATIM — for a runtime design its injected
    // CSS takes over; for a missing one the fall-through to the bare default is
    // the visible signal (never a silent guess).
    applyDesign('fluent');
    expect(document.documentElement.getAttribute('data-design')).toBe('fluent');
    applyDesign(DEFAULT_DESIGN_ID);
    expect(document.documentElement.getAttribute('data-design')).toBeNull();
  });

  it('stamps the default’s variant family; an UNregistered id falls through to it', () => {
    // The baked default ships its own variant layer (meta.variant === 'minimal').
    applyDesign(DEFAULT_DESIGN_ID);
    expect(document.documentElement.getAttribute('data-design-variant')).toBe('minimal');
    // 'ios' is neither baked nor runtime-registered here → variant resolution
    // falls through getDesign() to the default design's family.
    applyDesign('ios');
    expect(document.documentElement.getAttribute('data-design-variant')).toBe('minimal');
  });

  it('a runtime-registered design plugin appears in the registry and drives applyDesign', () => {
    // Before registration nothing is known about the id.
    expect(getRuntimeDesign('editorial')).toBeUndefined();

    let notified = 0;
    const unsubscribe = subscribeRuntimeDesigns(() => {
      notified += 1;
    });
    // What the host's design-plugin handler does after injecting the CSS <link>.
    registerDesign('editorial', 'editorial', {
      name: 'Editorial',
      description: 'Premium design plugin (runtime-loaded)',
    });
    expect(notified).toBe(1);
    // Idempotent by designId — an identical re-registration must not re-notify.
    registerDesign('editorial', 'editorial', {
      name: 'Editorial',
      description: 'Premium design plugin (runtime-loaded)',
    });
    expect(notified).toBe(1);
    unsubscribe();

    expect(getRuntimeDesign('editorial')).toMatchObject({ designId: 'editorial', variant: 'editorial' });
    expect(getRuntimeDesigns().map((r) => r.designId)).toContain('editorial');
    // Still NOT baked — the registry is the runtime layer, not theme.css.
    expect(DESIGNS['editorial']).toBeUndefined();

    // applyDesign resolves the variant from the RUNTIME registry (no baked entry).
    applyDesign('editorial');
    expect(document.documentElement.getAttribute('data-design')).toBe('editorial');
    expect(document.documentElement.getAttribute('data-design-variant')).toBe('editorial');
  });

  it('resolveInitialDesign reads localStorage, else falls back to the default (minimal)', () => {
    expect(resolveInitialDesign()).toBe('minimal');
    // A stored premium pick is returned verbatim — the runtime registry + plugin
    // CSS make it real after composition load.
    localStorage.setItem('digita-ui:design', 'material');
    expect(resolveInitialDesign()).toBe('material');
  });

  it('getDesign resolves any un-BAKED id VISIBLY to the default (no silent guess)', () => {
    expect(getDesign('does-not-exist').meta.id).toBe(DEFAULT_DESIGN_ID);
    // Premium ids are un-baked now, so the BAKED lookup falls through too —
    // their real tokens live in the runtime-delivered plugin CSS.
    expect(getDesign('fluent').meta.id).toBe(DEFAULT_DESIGN_ID);
    expect(getDesign(DEFAULT_DESIGN_ID).meta.id).toBe('minimal');
  });
});
