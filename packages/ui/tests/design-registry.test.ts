// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  DESIGN_LIST,
  DESIGNS,
  DEFAULT_DESIGN_ID,
  getDesign,
  applyDesign,
  resolveInitialDesign,
} from '@digitaplatform/theme';

describe('design registry + runtime', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-design');
    document.documentElement.removeAttribute('data-design-variant');
    localStorage.clear();
  });

  it('registers the five design languages with editorial as the default', () => {
    const ids = DESIGN_LIST.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(['editorial', 'fluent', 'minimal', 'ios', 'material']));
    expect(DEFAULT_DESIGN_ID).toBe('editorial');
  });

  it('every design defines all on-color tokens for both modes', () => {
    for (const d of Object.values(DESIGNS)) {
      for (const mode of ['light', 'dark'] as const) {
        expect(d.semantic[mode].onPrimary).toBeTruthy();
        expect(d.semantic[mode].onError).toBeTruthy();
      }
    }
  });

  it('applyDesign flips data-design; the DEFAULT design removes it (bare :root)', () => {
    applyDesign('fluent');
    expect(document.documentElement.getAttribute('data-design')).toBe('fluent');
    applyDesign('minimal');
    expect(document.documentElement.getAttribute('data-design')).toBe('minimal');
    applyDesign(DEFAULT_DESIGN_ID);
    expect(document.documentElement.getAttribute('data-design')).toBeNull();
  });

  it('stamps data-design-variant with each design’s component-variant family', () => {
    // Every registered design ships its own variant layer (meta.variant === id),
    // including the default — the attribute always reflects the ACTIVE family.
    applyDesign('material');
    expect(document.documentElement.getAttribute('data-design-variant')).toBe('material');
    applyDesign('ios');
    expect(document.documentElement.getAttribute('data-design-variant')).toBe('ios');
    applyDesign(DEFAULT_DESIGN_ID);
    expect(document.documentElement.getAttribute('data-design-variant')).toBe('editorial');
  });

  it('resolveInitialDesign reads localStorage, else falls back to the default', () => {
    expect(resolveInitialDesign()).toBe(DEFAULT_DESIGN_ID);
    localStorage.setItem('digita-ui:design', 'minimal');
    expect(resolveInitialDesign()).toBe('minimal');
  });

  it('getDesign resolves an unknown id VISIBLY to the default (no silent guess)', () => {
    expect(getDesign('does-not-exist').meta.id).toBe(DEFAULT_DESIGN_ID);
    expect(getDesign('fluent').meta.id).toBe('fluent');
  });
});
