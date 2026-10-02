// @vitest-environment jsdom
// The one rule for a page's tab icon, which the app, the website, the sign-in pages and the report
// designer share: the tenant's favicon, else the icon of the signature the page wears.
import { describe, it, expect, beforeEach } from 'vitest';
import { showTabIcon, tabIconHref } from '../src/index.js';

const ICON = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>';

describe('tabIconHref', () => {
  it("takes the tenant's favicon over the signature's icon", () => {
    expect(tabIconHref('/api/v1/public/file/f1', { icon: ICON })).toBe('/api/v1/public/file/f1');
  });

  it("takes the signature's icon as an svg address where the tenant set no favicon", () => {
    expect(tabIconHref(undefined, { icon: ICON })).toBe(`data:image/svg+xml,${encodeURIComponent(ICON)}`);
    expect(tabIconHref('', { icon: ICON })).toBe(`data:image/svg+xml,${encodeURIComponent(ICON)}`);
  });

  it('PLANTED INNOCENT: names none where neither does, so the page keeps the platform icon', () => {
    expect(tabIconHref(null, {})).toBeNull();
    expect(tabIconHref(undefined, undefined)).toBeNull();
  });
});

describe('showTabIcon', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('keeps one icon link, so the last call decides what the tab shows', () => {
    showTabIcon('/platform.svg');
    showTabIcon('/tenant.png');
    const links = document.head.querySelectorAll('link[rel="icon"]');
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('/tenant.png');
  });

  it("drops a type the page's first icon carried, which would misname the next one", () => {
    document.head.innerHTML = '<link rel="icon" type="image/svg+xml" href="/platform.svg">';
    showTabIcon('/tenant.png');
    expect(document.head.querySelector('link[rel="icon"]')!.hasAttribute('type')).toBe(false);
  });
});
