// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// vitest runs a package's tests from its root.
const BASE_CSS = readFileSync(join(process.cwd(), 'build/variants/base.css'), 'utf8');

function mountHeader(collapsed: boolean): Record<string, HTMLElement> {
  const header = document.createElement('header');
  header.setAttribute('data-ui', 'page-header');
  header.setAttribute('data-collapsed', String(collapsed));
  const parts: Record<string, HTMLElement> = {};
  for (const hook of ['page-header-bar-title', 'page-header-title', 'page-header-search']) {
    const el = document.createElement('div');
    el.setAttribute('data-ui', hook);
    header.append(el);
    parts[hook] = el;
  }
  document.body.append(header);
  return parts;
}

describe('page header collapse in base.css', () => {
  beforeAll(() => {
    const style = document.createElement('style');
    style.textContent = BASE_CSS;
    document.head.append(style);
  });

  it('hides the title block and the search slot behind the bar mirror once collapsed', () => {
    const parts = mountHeader(true);
    expect(getComputedStyle(parts['page-header-title']).opacity).toBe('0');
    expect(getComputedStyle(parts['page-header-bar-title']).opacity).toBe('1');
    expect(getComputedStyle(parts['page-header-search']).opacity).toBe('0');
    // Faded, not hidden: the search field keeps its place in the tab order.
    expect(getComputedStyle(parts['page-header-search']).visibility).not.toBe('hidden');
  });

  it('leaves the title block and the search slot alone while not collapsed', () => {
    const parts = mountHeader(false);
    expect(getComputedStyle(parts['page-header-title']).opacity).not.toBe('0');
    expect(getComputedStyle(parts['page-header-search']).opacity).not.toBe('0');
  });
});
