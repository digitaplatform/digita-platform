import type { Signature } from '../signatures/index.js';

/**
 * The icon a page shows on its browser tab: the tenant's favicon, else the tab icon of the signature
 * the page wears. Null where neither names one: the page keeps the platform's icon it ships with.
 */
export function tabIconHref(favicon: string | null | undefined, signature: Pick<Signature, 'icon'> | undefined): string | null {
  if (favicon) return favicon;
  return signature?.icon ? `data:image/svg+xml,${encodeURIComponent(signature.icon)}` : null;
}

/** Put `href` on the page's tab. One icon link is kept, so the last call decides what the tab shows. */
export function showTabIcon(href: string, doc: Document = document): void {
  const link =
    doc.head.querySelector<HTMLLinkElement>('link[rel="icon"]') ??
    doc.head.appendChild(Object.assign(doc.createElement('link'), { rel: 'icon' }));
  // A type left from the platform's svg would misname a tenant's png.
  link.removeAttribute('type');
  link.setAttribute('href', href);
}
