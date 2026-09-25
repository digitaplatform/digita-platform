// @vitest-environment jsdom
// One identity boot for the app and the server-rendered website: the stored choices land in the
// order the layers compose, the tenant's branding wins over the signature, and a stored density
// wins over the branding's. The website's pre-paint script runs the same function on the data
// its server wrote.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  bootIdentity,
  resetSignature,
  DESIGN_STORAGE_KEY,
  DENSITY_STORAGE_KEY,
  MODE_STORAGE_KEY,
  SIGNATURE_STORAGE_KEY,
  TINT_STORAGE_KEY_PREFIX,
  DEFAULT_DESIGN_ID,
  type Signature,
} from '../src/index.js';

const brand: Signature = {
  id: 'brand1',
  name: 'Brand',
  accent: '#0E6FB8',
  fonts: { sans: "'Manrope', sans-serif" },
  colors: { surface: { light: '#ffffff', dark: '#070e19' } },
  graphics: { grid: { light: 'url(l)', dark: 'url(d)' } },
};

const root = () => document.documentElement;

beforeEach(() => {
  localStorage.clear();
  resetSignature();
  root().removeAttribute('style');
  root().removeAttribute('class');
  for (const name of ['data-design', 'data-design-variant', 'data-tint', 'data-density', 'data-signature']) {
    root().removeAttribute(name);
  }
});

describe('bootIdentity', () => {
  it('applies the stored design, tint, mode, signature and density', () => {
    localStorage.setItem(MODE_STORAGE_KEY, 'dark');
    localStorage.setItem(`${TINT_STORAGE_KEY_PREFIX}:${DEFAULT_DESIGN_ID}`, 'teal');
    localStorage.setItem(SIGNATURE_STORAGE_KEY, 'brand1');
    localStorage.setItem(DENSITY_STORAGE_KEY, 'spacious');

    const booted = bootIdentity({ signatures: [brand] });

    expect(booted).toEqual({ design: DEFAULT_DESIGN_ID, mode: 'dark', signature: 'brand1', density: 'spacious' });
    expect(root().classList.contains('dark')).toBe(true);
    expect(root().getAttribute('data-tint')).toBe('teal');
    expect(root().getAttribute('data-signature')).toBe('brand1');
    expect(root().getAttribute('data-density')).toBe('spacious');
    expect(root().style.getPropertyValue('--sig-grid-d')).toBe('url(d)');
  });

  it('lays the tenant branding over the signature, and keeps the stored density over the branding one', () => {
    localStorage.setItem(DENSITY_STORAGE_KEY, 'spacious');
    bootIdentity({ signatures: [brand], branding: { fonts: { sans: "'Inter', sans-serif" }, density: 'compact' } });

    expect(root().style.getPropertyValue('--font-sans')).toBe("'Inter', sans-serif");
    expect(root().getAttribute('data-density')).toBe('spacious');
  });

  it('falls back to the default design and the pointer density when nothing is stored', () => {
    const booted = bootIdentity({ signatures: [brand] });

    expect(root().hasAttribute('data-design')).toBe(false);
    expect(booted.density).toBe('comfortable');
    expect(root().getAttribute('data-density')).toBe('comfortable');
  });
  it("moves the choices stored under the app's former name to the current keys, where a current one wins", () => {
    localStorage.clear();
    localStorage.setItem('digita-ui:theme-mode', 'dark');
    localStorage.setItem('digita-ui:tint:minimal', 'teal');
    localStorage.setItem('digita-ui:design', 'material');
    localStorage.setItem(DESIGN_STORAGE_KEY, DEFAULT_DESIGN_ID);
    const booted = bootIdentity();
    expect(booted.mode).toBe('dark');
    expect(booted.design).toBe(DEFAULT_DESIGN_ID);
    expect(root().getAttribute('data-tint')).toBe('teal');
    expect(Object.keys(localStorage).filter((key) => key.startsWith('digita-ui:'))).toEqual([]);
  });
});

describe('the pre-paint script', () => {
  it('boots the identity from the data the server wrote into the page', async () => {
    localStorage.setItem(MODE_STORAGE_KEY, 'dark');
    localStorage.setItem(DESIGN_STORAGE_KEY, DEFAULT_DESIGN_ID);
    localStorage.setItem(SIGNATURE_STORAGE_KEY, 'brand1');
    const data = document.createElement('script');
    data.type = 'application/json';
    data.id = 'digita-identity';
    data.textContent = JSON.stringify({ signatures: [brand], branding: { fonts: { mono: "'JetBrains Mono', monospace" } } });
    document.head.appendChild(data);

    vi.resetModules();
    await import('../src/runtime/identity-boot-script.js');

    expect(root().classList.contains('dark')).toBe(true);
    expect(root().getAttribute('data-signature')).toBe('brand1');
    expect(root().style.getPropertyValue('--font-mono')).toBe("'JetBrains Mono', monospace");
    data.remove();
  });
});
