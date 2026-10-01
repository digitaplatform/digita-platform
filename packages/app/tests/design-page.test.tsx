// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as kit from '@digitaplatform/components';
import { useSessionStore } from '@/stores/session';
import type { SessionUser } from '@/types';

// The theme store roams every choice to the engine; the showcase test has no engine.
vi.mock('@/services/userPreference', () => ({
  getUserPreference: vi.fn().mockResolvedValue(undefined),
  setUserPreference: vi.fn().mockResolvedValue(undefined),
}));

const { default: DesignPage } = await import('@/pages/DesignPage');

// jsdom has no layout: give the DataGrid virtualizer a measurable viewport so its
// rows mount, as datagrid.test.tsx does.
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
afterEach(() => useSessionStore.setState({ user: null }));

function signIn(roles: string[]) {
  useSessionStore.setState({ user: { _id: 'u1', email: 'reviewer@example.com', roles } as SessionUser });
}

function renderDesignRoute() {
  return render(
    <MemoryRouter initialEntries={['/_design']}>
      <Routes>
        <Route path="/_design" element={<DesignPage />} />
        <Route path="/" element={<p>start page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Every data-ui hook the kit's source emits: the denominator of the coverage matrix. */
function kitHooks(): Set<string> {
  const src = join(import.meta.dirname, '../../components/src');
  const hooks = new Set<string>();
  const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.tsx'));
  for (const file of files) {
    const text = readFileSync(join(src, file), 'utf8');
    // data-ui="x", 'data-ui': 'x', and data-ui={cond ? 'x' : 'y'}
    for (const m of text.matchAll(/data-ui="([a-z][a-z-]*)"/g)) hooks.add(m[1]!);
    for (const m of text.matchAll(/'data-ui': '([a-z][a-z-]*)'/g)) hooks.add(m[1]!);
    for (const m of text.matchAll(/data-ui=\{([^}]*)\}/g)) {
      for (const lit of m[1]!.matchAll(/'([a-z][a-z-]*)'/g)) hooks.add(lit[1]!);
    }
  }
  return hooks;
}

// Hooks the kit renders only from a measured layout or a touch gesture, which
// jsdom cannot produce; a browser shows them on the page.
const NEEDS_A_BROWSER: Record<string, string> = {
  'grid-collapsed-chip': 'appears when the grid measures its container narrower than its columns',
  'pull-to-refresh-indicator': 'appears only during a touch pull or a pending refresh',
};

function gallery(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-showcase-section="gallery"]')!;
}

function galleryReadout(): Set<string> {
  const hooks = new Set<string>();
  gallery()
    .querySelectorAll('output')
    .forEach((o) => o.textContent!.split(' · ').forEach((h) => h !== '—' && hooks.add(h)));
  return hooks;
}

describe('/_design route guard', () => {
  it('sends a signed-in user without the Administrator role where an unknown path goes', () => {
    signIn(['Sales User']);
    renderDesignRoute();
    expect(screen.getByText('start page')).toBeInTheDocument();
    expect(document.querySelector('[data-showcase-group]')).toBeNull();
  });

  it('renders the showcase for an administrator', () => {
    signIn(['Administrator']);
    renderDesignRoute();
    expect(screen.queryByText('start page')).toBeNull();
    expect(document.querySelector('[data-showcase-section="gallery"]')).not.toBeNull();
  });
});

describe('/_design gallery', () => {
  it('has a group for every component the kit exports', () => {
    signIn(['Administrator']);
    renderDesignRoute();
    const components = Object.keys(kit).filter((name) => /^[A-Z][a-z]/.test(name));
    const shown = new Set(
      Array.from(gallery().querySelectorAll<HTMLElement>('[data-showcase-group]')).flatMap((g) =>
        g.dataset.showcaseExports!.split(' '),
      ),
    );
    const missing = components.filter((name) => !shown.has(name));
    expect(components.length).toBeGreaterThan(50);
    expect(missing).toEqual([]);
  });

  // It opens every overlay of the kit in jsdom: about 3 s alone, and the suite's other workers and
  // parallel test runs on the machine stretch that past the 5 s default, so it declares 30 s.
  it('lists beside its groups every data-ui hook the kit emits, once every overlay was opened', async () => {
    signIn(['Administrator']);
    const user = userEvent.setup();
    renderDesignRoute();

    // Overlays and toasts open from the showcase's own openers; each overlay is
    // closed again before the next one opens, as a reviewer would.
    for (const opener of Array.from(gallery().querySelectorAll<HTMLElement>('[data-showcase-opener]'))) {
      await user.click(opener);
      if (opener.getAttribute('aria-expanded') === 'true') await user.click(opener);
    }
    // Select, Menu and DatePicker keep their open state inside; their trigger opens them.
    for (const trigger of Array.from(gallery().querySelectorAll<HTMLElement>('[aria-haspopup]:not([disabled])'))) {
      await user.click(trigger);
      await user.keyboard('{Escape}');
    }
    for (const button of screen.getAllByRole('button', { name: /^(Duplicate|Submit)$/ })) {
      if (gallery().contains(button)) await user.hover(button);
    }
    await act(async () => {});

    const expected = [...kitHooks()].filter((hook) => !(hook in NEEDS_A_BROWSER));
    const listed = galleryReadout();
    const missing = expected.filter((hook) => !listed.has(hook));
    expect(expected.length).toBeGreaterThanOrEqual(82);
    expect(missing).toEqual([]);
  }, 30_000);
});
