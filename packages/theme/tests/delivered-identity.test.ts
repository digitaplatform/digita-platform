// @vitest-environment jsdom
// What a design or signature plugin delivers lands in the theme the same way in the app and on
// the website: the stylesheet once, the design registered and re-applied when it is the active
// one, the signature's full identity resolvable by id.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getRuntimeDesign,
  getSignature,
  loadDeliveredDesign,
  readPageIdentity,
  registerDeliveredSignature,
  PAGE_IDENTITY_ELEMENT_ID,
} from '../src/index.js';

const root = () => document.documentElement;
const stylesheet = (designId: string) =>
  document.head.querySelector<HTMLLinkElement>(`link[data-design-plugin="${designId}"]`);

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  root().removeAttribute('data-design');
  root().removeAttribute('data-design-variant');
});

describe('loadDeliveredDesign', () => {
  it('injects the stylesheet once, registers the design, and re-applies it when it is the active one', async () => {
    root().setAttribute('data-design', 'glass');
    const loading = loadDeliveredDesign({ designId: 'glass', variant: 'glass', cssUrl: '/erp/plugins/glass.css', title: 'Glass' });
    expect(stylesheet('glass')?.getAttribute('href')).toBe('/erp/plugins/glass.css');
    stylesheet('glass')!.dispatchEvent(new Event('load'));
    await loading;
    expect(getRuntimeDesign('glass')).toMatchObject({ variant: 'glass' });
    expect(root().getAttribute('data-design-variant')).toBe('glass');

    await loadDeliveredDesign({ designId: 'glass', variant: 'glass', cssUrl: '/erp/plugins/glass.css' });
    expect(document.head.querySelectorAll('link[data-design-plugin="glass"]')).toHaveLength(1);
  });

  it('rejects, removes the link and registers nothing when the stylesheet fails', async () => {
    const loading = loadDeliveredDesign({ designId: 'broken', variant: 'broken', cssUrl: '/erp/plugins/broken.css' });
    stylesheet('broken')!.dispatchEvent(new Event('error'));
    await expect(loading).rejects.toThrow('stylesheet failed to load: /erp/plugins/broken.css');
    expect(stylesheet('broken')).toBeNull();
    expect(getRuntimeDesign('broken')).toBeUndefined();
  });
});

describe('registerDeliveredSignature', () => {
  it('makes the delivered identity resolvable by id, named by its title', () => {
    registerDeliveredSignature({ id: 'aurora', title: 'Aurora', accent: '#123456', monogram: '<svg/>' });
    expect(getSignature('aurora')).toMatchObject({ id: 'aurora', name: 'Aurora', accent: '#123456', monogram: '<svg/>' });
  });

  it('names a signature without a title by its id and gives a thin one no accent', () => {
    registerDeliveredSignature({ id: 'plain' });
    expect(getSignature('plain')).toMatchObject({ id: 'plain', name: 'plain', accent: '' });
  });
});

describe('readPageIdentity', () => {
  it('reads the identity data the server wrote into the page, and null on a page without it', () => {
    expect(readPageIdentity()).toBeNull();
    const script = document.createElement('script');
    script.type = 'application/json';
    script.id = PAGE_IDENTITY_ELEMENT_ID;
    script.textContent = JSON.stringify({ branding: { app_name: 'Acme' } });
    document.body.appendChild(script);
    expect(readPageIdentity()).toEqual({ branding: { app_name: 'Acme' } });
  });
});
