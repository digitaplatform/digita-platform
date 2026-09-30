// A print button is an entity's link to a report: its params come from the document through
// `param_map`, its address is built here, and `show_if` decides whether the button is offered at all.
// A wrong param, address or rule gives the receptionist a blank preview or the wrong document.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntityReportLink } from '@digitaplatform/shared';
import { REPORT_URL, reportLinkVisible, reportRenderUrl, resolveReportParams } from '@/lib/report-link';

function buildLink(extra: Partial<EntityReportLink> = {}): EntityReportLink {
  return { report: 'invoice', ...extra };
}

describe('resolveReportParams', () => {
  const doc = {
    _id: 'INV-7',
    total: 0,
    is_paid: false,
    remark: '',
    customer: { name: 'Acme', address: { city: 'Zürich' } },
    note: null,
  };

  it('reads a param from a field of the document', () => {
    expect(resolveReportParams(buildLink({ param_map: { invoice: '_id' } }), doc)).toEqual({ invoice: 'INV-7' });
  });

  it('follows a nested path through the document', () => {
    const link = buildLink({ param_map: { customer: 'customer.name', city: 'customer.address.city' } });
    expect(resolveReportParams(link, doc)).toEqual({ customer: 'Acme', city: 'Zürich' });
  });

  it('leaves out a param whose path is missing, however deep the gap is', () => {
    const link = buildLink({ param_map: { phone: 'customer.phone', street: 'owner.address.street', invoice: '_id' } });
    expect(resolveReportParams(link, doc)).toEqual({ invoice: 'INV-7' });
  });

  it('leaves out a param whose value is null', () => {
    expect(resolveReportParams(buildLink({ param_map: { note: 'note', invoice: '_id' } }), doc)).toEqual({ invoice: 'INV-7' });
  });

  it('keeps the values that are falsy but set, as text', () => {
    const link = buildLink({ param_map: { total: 'total', paid: 'is_paid', remark: 'remark' } });
    expect(resolveReportParams(link, doc)).toEqual({ total: '0', paid: 'false', remark: '' });
  });

  it('gives no params when the link maps none', () => {
    expect(resolveReportParams(buildLink(), doc)).toEqual({});
  });
});

describe('reportRenderUrl', () => {
  const renderPath = `${REPORT_URL}/api/v1/report/definitions/invoice/render`;

  it('addresses the render of the report in the requested format, with the params', () => {
    expect(reportRenderUrl('invoice', { invoice: 'INV-7' }, 'html')).toBe(`${renderPath}?format=html&invoice=INV-7`);
  });

  it('adds the print flag for the self-printing variant, and only then', () => {
    expect(reportRenderUrl('invoice', { invoice: 'INV-7' }, 'html', { print: true })).toBe(`${renderPath}?format=html&invoice=INV-7&print=1`);
    expect(reportRenderUrl('invoice', { invoice: 'INV-7' }, 'html', { print: false })).toBe(`${renderPath}?format=html&invoice=INV-7`);
  });

  it.each(['html', 'pdf', 'png', 'csv'] as const)('asks for the %s format', (format) => {
    expect(reportRenderUrl('invoice', {}, format)).toBe(`${renderPath}?format=${format}`);
  });

  it('escapes the name of the report in the path and the params in the query', () => {
    const url = new URL(reportRenderUrl('monthly summary/2026', { customer: 'Müller & Söhne' }, 'pdf'));
    expect(url.pathname.endsWith('/definitions/monthly%20summary%2F2026/render')).toBe(true);
    expect(url.searchParams.get('customer')).toBe('Müller & Söhne');
    expect(url.searchParams.get('format')).toBe('pdf');
  });
});

describe('the address of the report service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function importFreshModule() {
    vi.resetModules();
    return import('@/lib/report-link');
  }

  it('is the address the pod writes into the page, without a trailing slash', async () => {
    vi.stubGlobal('window', { __REPORT_URL__: 'https://reports.acme.example/' });
    const { REPORT_URL: injected, reportRenderUrl: render } = await importFreshModule();
    expect(injected).toBe('https://reports.acme.example');
    expect(render('invoice', {}, 'pdf')).toBe('https://reports.acme.example/api/v1/report/definitions/invoice/render?format=pdf');
  });

  it('is the build-time address when the page carries none', async () => {
    vi.stubEnv('VITE_REPORT_URL', 'https://build.example//');
    const { REPORT_URL: built } = await importFreshModule();
    expect(built).toBe('https://build.example');
  });

  it('prefers the address of the page over the build-time one', async () => {
    vi.stubGlobal('window', { __REPORT_URL__: 'https://reports.acme.example' });
    vi.stubEnv('VITE_REPORT_URL', 'https://build.example');
    const { REPORT_URL: chosen } = await importFreshModule();
    expect(chosen).toBe('https://reports.acme.example');
  });

  it('falls back to the local report server when nothing names an address', async () => {
    vi.stubEnv('VITE_REPORT_URL', '');
    const { REPORT_URL: fallback } = await importFreshModule();
    expect(fallback).toBe('http://localhost:3400');
  });
});

describe('reportLinkVisible', () => {
  const draft = { status: 'Draft', docstatus: 0, is_paid: true, customer: { email: 'ap@acme.example' } };
  const submitted = { status: 'Submitted', docstatus: 1, is_paid: false, customer: { email: '' } };

  it('offers a link that has no show_if', () => {
    expect(reportLinkVisible(buildLink(), draft)).toBe(true);
    expect(reportLinkVisible(buildLink({ show_if: '' }), draft)).toBe(true);
  });

  it('offers a link with == when the field equals the literal, and hides it otherwise', () => {
    const link = buildLink({ show_if: "doc.status == 'Submitted'" });
    expect(reportLinkVisible(link, submitted)).toBe(true);
    expect(reportLinkVisible(link, draft)).toBe(false);
  });

  it('offers a link with != when the field differs from the literal, and hides it otherwise', () => {
    const link = buildLink({ show_if: "doc.status != 'Draft'" });
    expect(reportLinkVisible(link, submitted)).toBe(true);
    expect(reportLinkVisible(link, draft)).toBe(false);
  });

  it('reads the literal as text, number or boolean, whichever way it is quoted', () => {
    expect(reportLinkVisible(buildLink({ show_if: 'doc.status == "Submitted"' }), submitted)).toBe(true);
    expect(reportLinkVisible(buildLink({ show_if: 'doc.status == Submitted' }), submitted)).toBe(true);
    expect(reportLinkVisible(buildLink({ show_if: 'doc.docstatus == 1' }), submitted)).toBe(true);
    expect(reportLinkVisible(buildLink({ show_if: 'doc.docstatus == 1' }), draft)).toBe(false);
    expect(reportLinkVisible(buildLink({ show_if: 'doc.is_paid == true' }), draft)).toBe(true);
    expect(reportLinkVisible(buildLink({ show_if: 'doc.is_paid == false' }), draft)).toBe(false);
  });

  it('compares a stored number with its literal as text too', () => {
    expect(reportLinkVisible(buildLink({ show_if: 'doc.docstatus == 1' }), { docstatus: '1' })).toBe(true);
  });

  it('takes the eval: prefix off the rule', () => {
    const link = buildLink({ show_if: "eval:doc.status == 'Submitted'" });
    expect(reportLinkVisible(link, submitted)).toBe(true);
    expect(reportLinkVisible(link, draft)).toBe(false);
  });

  it('follows a nested path in the rule', () => {
    expect(reportLinkVisible(buildLink({ show_if: "doc.customer.email == 'ap@acme.example'" }), draft)).toBe(true);
    expect(reportLinkVisible(buildLink({ show_if: "doc.customer.email == 'ap@acme.example'" }), submitted)).toBe(false);
  });

  it('offers a link with a bare path when the field has a value, and hides it when it is empty or missing', () => {
    const link = buildLink({ show_if: 'doc.customer.email' });
    expect(reportLinkVisible(link, draft)).toBe(true);
    expect(reportLinkVisible(link, submitted)).toBe(false);
    expect(reportLinkVisible(link, {})).toBe(false);
    expect(reportLinkVisible(buildLink({ show_if: 'doc.docstatus' }), { docstatus: 0 })).toBe(false);
    expect(reportLinkVisible(buildLink({ show_if: 'doc.is_paid' }), draft)).toBe(true);
  });

  it('treats a missing field as different from any literal', () => {
    expect(reportLinkVisible(buildLink({ show_if: "doc.status == 'Submitted'" }), {})).toBe(false);
    expect(reportLinkVisible(buildLink({ show_if: "doc.status != 'Submitted'" }), {})).toBe(true);
  });

  it('offers a link whose rule it cannot read, because the report service is the real gate', () => {
    expect(reportLinkVisible(buildLink({ show_if: 'doc.total > 100' }), draft)).toBe(true);
    expect(reportLinkVisible(buildLink({ show_if: 'user.role == "Clerk"' }), draft)).toBe(true);
  });
});
