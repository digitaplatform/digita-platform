import { describe, it, expect } from 'vitest';
import type { EntityDefinition, EntityReportLink } from '@digitaplatform/shared';
import { localizeMeta } from '@/lib/localize-meta';

/**
 * A report link names its print button, menu entry and preview title. The entity file writes its
 * label once, so an app translates it under `report.<Entity>.<report>`, keyed like an action label.
 * The record page and the list page both read the links from the localized meta.
 */

const INVOICE: EntityReportLink = { report: 'invoice', label: 'Invoice', param_map: { invoice: '_id' } };
const DELIVERY: EntityReportLink = { report: 'delivery-note', label: 'Delivery note' };

function entityWith(name: string, reports?: EntityReportLink[]): EntityDefinition {
  return { name, label: name, fields: [], ...(reports ? { reports } : {}) } as unknown as EntityDefinition;
}

const t: Record<string, string> = {
  'report.Invoice.invoice': 'Rechnung',
  'report.Order.invoice': 'Auftragsrechnung',
};

describe('localizeMeta reports', () => {
  it('translates a report link label by its entity and report, and keeps everything else of it', () => {
    const out = localizeMeta(entityWith('Invoice', [INVOICE]), t);
    expect(out.reports).toEqual([{ ...INVOICE, label: 'Rechnung' }]);
  });

  it('reads the key of its own entity, not of another entity linking the same report', () => {
    expect(localizeMeta(entityWith('Order', [INVOICE]), t).reports![0]!.label).toBe('Auftragsrechnung');
  });

  it('keeps the written label where no key exists', () => {
    expect(localizeMeta(entityWith('Invoice', [DELIVERY]), t).reports![0]!.label).toBe('Delivery note');
  });

  it('gives a link without a written label the text of its key, and leaves it without one otherwise', () => {
    const out = localizeMeta(entityWith('Invoice', [{ report: 'invoice' }, { report: 'packing-slip' }]), t);
    expect(out.reports!.map((link) => link.label)).toEqual(['Rechnung', undefined]);
  });

  it('does not mutate the input meta', () => {
    const meta = entityWith('Invoice', [INVOICE]);
    localizeMeta(meta, t);
    expect(meta.reports![0]!.label).toBe('Invoice');
  });

  it('adds no reports to an entity without any', () => {
    expect(localizeMeta(entityWith('Invoice'), t)).not.toHaveProperty('reports');
  });
});
