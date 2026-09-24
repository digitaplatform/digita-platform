// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyBranding,
  applySignature,
  brandingStyle,
  resetSignature,
  registerSignature,
  signatureStyle,
  getSignature,
  type IdentityStyle,
} from '../src/index.js';

/** What the document root carries, read back in the shape of an IdentityStyle. */
function rootStyle(attributeNames: string[]): IdentityStyle {
  const root = document.documentElement;
  const properties: Record<string, string> = {};
  for (let i = 0; i < root.style.length; i++) {
    const name = root.style.item(i);
    properties[name] = root.style.getPropertyValue(name);
  }
  const attributes: Record<string, string> = {};
  for (const name of attributeNames) {
    const value = root.getAttribute(name);
    if (value !== null) attributes[name] = value;
  }
  return { attributes, properties };
}

describe('identity styles are what the DOM runtime writes', () => {
  beforeEach(() => {
    resetSignature();
    document.documentElement.removeAttribute('style');
  });

  it('applySignature writes exactly signatureStyle of the same full signature', () => {
    registerSignature({
      id: 'full1',
      name: 'Full',
      accent: '#0E6FB8',
      fonts: { sans: 'SansFont' },
      colors: { bg: { light: '#fff', dark: '#000' } },
      graphics: { glow: { light: 'none', dark: 'red' } },
    });
    applySignature('full1');
    expect(rootStyle(['data-signature', 'data-density'])).toEqual(signatureStyle(getSignature('full1')));
  });

  it('applyBranding writes exactly brandingStyle, attributes included', () => {
    const branding = { primary_color: '#AA3300', accent_palette: 'purple', density: 'compact' as const };
    applyBranding(branding);
    const style = brandingStyle(branding);
    expect(style.attributes).toEqual({ 'data-density': 'compact' });
    expect(style.properties['--color-primary-600']).toBeTruthy();
    expect(style.properties['--color-accent-600']).toBe('#9333ea');
    expect(rootStyle(['data-signature', 'data-density'])).toEqual(style);
  });

  it('brandingStyle of no branding is empty', () => {
    expect(brandingStyle(null)).toEqual({ attributes: {}, properties: {} });
  });
});
