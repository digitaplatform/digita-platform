import { describe, it, expect } from 'vitest';
import type { EntityDefinition, LinkDefinition } from '@digitaplatform/shared';
import { localizeMeta } from '@/lib/localize-meta';

/**
 * A link of a record page has no id, so its text keys by what names it and stays when the links are
 * reordered: the linked entity and the field that points back, `link.<Entity>.<linked entity>.<link_field>`.
 * Two links that share both are told apart by that key followed by `.<written label>`, which wins over
 * the shorter key. A link without a key keeps the label the entity file writes.
 */

const INVOICES: LinkDefinition = { label: 'Invoices', entity: 'Invoice', link_field: 'sale', show_count: true, icon: 'file' };
const RETURNS: LinkDefinition = { label: 'Returns', entity: 'Invoice', link_field: 'return_of', filters: { docstatus: 1 } };
const PAYMENTS: LinkDefinition = { label: 'Payments', entity: 'Payment', link_field: 'sale' };

function saleWith(links?: LinkDefinition[]): EntityDefinition {
  return { name: 'Sale', label: 'Sale', fields: [], ...(links ? { links } : {}) } as unknown as EntityDefinition;
}

const t: Record<string, string> = {
  'link.Sale.Invoice.sale': 'Rechnungen',
  'link.Sale.Invoice.return_of': 'Gutschriften',
};

describe('localizeMeta links', () => {
  it('translates a link label by the linked entity and the link field', () => {
    const out = localizeMeta(saleWith([INVOICES]), t);
    expect(out.links![0]!.label).toBe('Rechnungen');
  });

  it('gives two links to one entity, through different fields, their own texts', () => {
    const out = localizeMeta(saleWith([INVOICES, RETURNS]), t);
    expect(out.links!.map((link) => link.label)).toEqual(['Rechnungen', 'Gutschriften']);
  });

  it('keeps the text with its link when the links are reordered', () => {
    const out = localizeMeta(saleWith([PAYMENTS, RETURNS, INVOICES]), t);
    expect(out.links!.map((link) => link.label)).toEqual(['Payments', 'Gutschriften', 'Rechnungen']);
  });

  it('keeps the written label where no key exists', () => {
    const out = localizeMeta(saleWith([PAYMENTS]), t);
    expect(out.links![0]!.label).toBe('Payments');
  });

  it('keeps everything else of a link', () => {
    const out = localizeMeta(saleWith([INVOICES, RETURNS]), t);
    expect(out.links![0]).toEqual({ ...INVOICES, label: 'Rechnungen' });
    expect(out.links![1]).toEqual({ ...RETURNS, label: 'Gutschriften' });
  });

  it('tells two links with the same entity and field apart by their written label', () => {
    const open: LinkDefinition = { label: 'Open invoices', entity: 'Invoice', link_field: 'sale', filters: { status: 'open' } };
    const paid: LinkDefinition = { label: 'Paid invoices', entity: 'Invoice', link_field: 'sale', filters: { status: 'paid' } };
    const out = localizeMeta(saleWith([open, paid]), {
      'link.Sale.Invoice.sale.Open invoices': 'Offene Rechnungen',
      'link.Sale.Invoice.sale.Paid invoices': 'Bezahlte Rechnungen',
      'link.Sale.Invoice.sale': 'Rechnungen',
    });
    expect(out.links!.map((link) => link.label)).toEqual(['Offene Rechnungen', 'Bezahlte Rechnungen']);
  });

  it('gives a link the text of the shorter key where no key adds its label', () => {
    const open: LinkDefinition = { label: 'Open invoices', entity: 'Invoice', link_field: 'sale' };
    const paid: LinkDefinition = { label: 'Paid invoices', entity: 'Invoice', link_field: 'sale' };
    const out = localizeMeta(saleWith([open, paid]), {
      'link.Sale.Invoice.sale.Paid invoices': 'Bezahlte Rechnungen',
      'link.Sale.Invoice.sale': 'Rechnungen',
    });
    expect(out.links!.map((link) => link.label)).toEqual(['Rechnungen', 'Bezahlte Rechnungen']);
  });

  it('does not mutate the input meta', () => {
    const meta = saleWith([INVOICES]);
    localizeMeta(meta, t);
    expect(meta.links![0]!.label).toBe('Invoices');
  });

  it('adds no links to an entity without any', () => {
    expect(localizeMeta(saleWith(), t)).not.toHaveProperty('links');
  });
});
