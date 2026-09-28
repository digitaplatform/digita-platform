// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { render, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DESIGN_LIST, type ThemeMode } from '@digitaplatform/theme';
import { useSessionStore } from '@/stores/session';
import { useThemeStore } from '@/stores/theme';
import type { SessionUser } from '@/types';

/**
 * The repository has no browser test runner (no Playwright), so this is the
 * showcase's image test in DOM form: per design and mode, the tokens the page
 * resolves and the computed style of a fixed set of hooks, one per element of the
 * four canvas surfaces, snapshotted.
 *
 * What it can see: theme.css of @digitaplatform/theme, which carries the tokens
 * and the variant layer of every design baked into this repository (DESIGN_LIST),
 * the kit's base hook rules, and the signature layer the theme store applies on
 * top. jsdom cascades rules and custom properties but resolves no var() and runs
 * no Tailwind, so a value reads as its declared text and the kit's utility
 * classes add nothing. What it cannot see: a premium design, whose CSS is
 * delivered at runtime from digita-plugins-store and never enters this
 * repository.
 */

vi.mock('@/services/userPreference', () => ({
  getUserPreference: vi.fn().mockResolvedValue(undefined),
  setUserPreference: vi.fn().mockResolvedValue(undefined),
}));

const { default: DesignPage } = await import('@/pages/DesignPage');

const THEME_CSS = readFileSync(createRequire(import.meta.url).resolve('@digitaplatform/theme/theme.css'), 'utf8');

/** One hook per element a reviewer compares on the canvas: list, record form, dialog, palette. */
const HOOKS = [
  'table',
  'table-header',
  'table-row',
  'field-label',
  'input',
  'input-frame',
  'select-trigger',
  'switch',
  'segmented',
  'dialog-overlay',
  'dialog',
  'dialog-header',
  'dialog-footer',
  'command-overlay',
  'command-palette',
  'command-item',
];

/** Tokens every hook inherits, read once per design and mode from <html>. */
const TOKENS = [
  'color-scheme',
  '--color-bg',
  '--color-surface',
  '--color-surface-glass',
  '--color-border',
  '--color-bg-hover',
  '--color-text-main',
  '--color-primary-600',
  '--color-scrim',
  '--radius-input',
  '--radius-btn',
  '--radius-card',
  '--radius-dialog',
  '--shadow-md',
  '--shadow-lg',
];

/** Properties a hook rule sets on the element itself. */
const PROPERTIES = ['background', 'border-bottom-color', 'border-radius', 'box-shadow', 'backdrop-filter', 'min-height'];

const MODES: ThemeMode[] = ['light', 'dark'];

const origRect = HTMLElement.prototype.getBoundingClientRect;
const origRO = globalThis.ResizeObserver;
const RECT = { width: 600, height: 480, top: 0, left: 0, right: 600, bottom: 480, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = () => RECT;
  globalThis.ResizeObserver = class {
    constructor(private cb: ResizeObserverCallback) {}
    observe(target: Element) {
      const size = [{ inlineSize: RECT.width, blockSize: RECT.height }];
      const entry = { target, contentRect: RECT, borderBoxSize: size, contentBoxSize: size };
      this.cb([entry as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = origRect;
  globalThis.ResizeObserver = origRO;
});

/** Renders the showcase with both surface overlays open, styled by `css`. */
async function openShowcase(style: HTMLStyleElement) {
  useSessionStore.setState({ user: { _id: 'u1', email: 'reviewer@example.com', roles: ['Administrator'] } as SessionUser });
  document.head.append(style);
  render(
    <MemoryRouter>
      <DesignPage />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  const surfaces = document.querySelector('[data-showcase-section="surfaces"]')!;
  for (const opener of Array.from(surfaces.querySelectorAll<HTMLElement>('[data-showcase-opener]'))) {
    await user.click(opener);
  }
}

function declared(el: Element, properties: string[]): string {
  const cs = getComputedStyle(el);
  return properties
    .map((p) => [p, cs.getPropertyValue(p).trim()] as const)
    .filter(([, v]) => v !== '')
    .map(([p, v]) => `${p}=${v}`)
    .join('; ');
}

/** Per design and mode: the tokens line, then one line per hook. */
function measure(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const design of DESIGN_LIST) {
    for (const mode of MODES) {
      act(() => {
        useThemeStore.getState().setDesign(design.id);
        useThemeStore.getState().setMode(mode);
      });
      out[`${design.id} · ${mode}`] = [
        `tokens: ${declared(document.documentElement, TOKENS)}`,
        ...HOOKS.map((hook) => {
          const el = document.querySelector(`[data-ui="${hook}"]`);
          return el ? `${hook}: ${declared(el, PROPERTIES)}` : `${hook}: not rendered`;
        }),
      ];
    }
  }
  return out;
}

describe('/_design computed style per design and mode', () => {
  it('matches the snapshot, and a removed theme rule changes it while a comment does not', async () => {
    const style = document.createElement('style');
    style.textContent = THEME_CSS;
    await openShowcase(style);

    const full = measure();
    for (const lines of Object.values(full)) expect(lines.filter((l) => l.endsWith('not rendered'))).toEqual([]);
    expect(full).toMatchSnapshot();

    // Planted defect: the baked minimal variant's rule for the list header is removed.
    const headerRule = /:root\[data-design-variant="minimal"\] \[data-ui="table-header"\] \{[^}]*\}/;
    expect(THEME_CSS).toMatch(headerRule);
    style.textContent = THEME_CSS.replace(headerRule, '');
    expect(measure()).not.toEqual(full);

    // Planted innocent change: a comment added.
    style.textContent = `/* reviewed */\n${THEME_CSS}`;
    expect(measure()).toEqual(full);
  });
});
