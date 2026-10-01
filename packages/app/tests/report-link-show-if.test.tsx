// @vitest-environment jsdom
// An app author writes "doc.status == Open && doc.member" as the show_if of a print link, as they
// would for an action. The print button reads the rule with the expression grammar of an action's
// show_if, with the document as `doc` and the signed-in user as `user`; a rule cut at its first
// comparison would compare the status with "Open && doc.member" and never offer the button, and a
// rule it skipped would offer the button always.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { EntityDefinition, EntityReportLink } from '@digitaplatform/shared';
import type { SessionUser } from '@/types';

const CLERK: SessionUser = { _id: 'u1', email: 'clerk@acme.example', roles: ['Clerk'] };
const MANAGER: SessionUser = { _id: 'u2', email: 'manager@acme.example', roles: ['Manager'] };

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));

vi.mock('@/stores/session', () => ({
  useSessionStore: (select: (state: Record<string, unknown>) => unknown) => select({ user: session.user }),
}));

import { PrintMenu } from '@/components/workflow/PrintMenu';
import { RowPrintButton } from '@/components/workflow/RowPrintButton';
import { reportLinkVisible } from '@/lib/report-link';

function linkWith(showIf: string): EntityReportLink {
  return { report: 'membership-card', label: 'Membership card', show_if: showIf };
}

function visible(showIf: string, doc: Record<string, unknown>, user: SessionUser | null = CLERK): boolean {
  return reportLinkVisible(linkWith(showIf), doc, user);
}

describe('the show_if of a report link', () => {
  it('offers the link only when both sides of && hold', () => {
    const rule = 'doc.status == Open && doc.member';
    expect(visible(rule, { status: 'Open', member: 'M-17' })).toBe(true);
    expect(visible(rule, { status: 'Open', member: '' })).toBe(false);
    expect(visible(rule, { status: 'Closed', member: 'M-17' })).toBe(false);
  });

  it('offers the link when either side of || holds', () => {
    const rule = "eval:doc.status == 'Draft' || doc.status == 'Open'";
    expect(visible(rule, { status: 'Open' })).toBe(true);
    expect(visible(rule, { status: 'Draft' })).toBe(true);
    expect(visible(rule, { status: 'Closed' })).toBe(false);
  });

  it('compares numbers', () => {
    expect(visible('doc.grand_total > 100', { grand_total: 150 })).toBe(true);
    expect(visible('doc.grand_total > 100', { grand_total: 80 })).toBe(false);
    expect(visible('doc.grand_total >= 100', { grand_total: 100 })).toBe(true);
    expect(visible('doc.grand_total > 100', {})).toBe(false);
  });

  it('negates', () => {
    expect(visible('!doc.is_paid', { is_paid: false })).toBe(true);
    expect(visible('!doc.is_paid', { is_paid: true })).toBe(false);
    expect(visible("!(doc.status == 'Cancelled')", { status: 'Cancelled' })).toBe(false);
  });

  it('reads the signed-in user as user', () => {
    const rule = "'Manager' in user.roles";
    expect(visible(rule, {}, MANAGER)).toBe(true);
    expect(visible(rule, {}, CLERK)).toBe(false);
    expect(visible(rule, {}, null)).toBe(false);
  });

  it('offers the link when the rule does not parse, because the report service is the real gate', () => {
    expect(visible("(doc.status == 'Open'", { status: 'Closed' })).toBe(true);
  });
});

describe('the print buttons of a document under a show_if with &&', () => {
  const link = linkWith('doc.status == Open && doc.member');
  const meta = {
    name: 'Membership',
    label: 'Membership',
    fields: [],
    reports: [link],
    permissions: [{ role: 'Clerk', level: 0, read: 1, print: 1 }],
  } as unknown as EntityDefinition;

  beforeEach(() => {
    session.user = CLERK;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('are offered on the record page when the rule holds', () => {
    render(<PrintMenu meta={meta} doc={{ status: 'Open', member: 'M-17' }} />);
    expect(screen.getByRole('button', { name: 'Membership card' })).toBeInTheDocument();
  });

  it('are left out on the record page when the rule fails', () => {
    const { container } = render(<PrintMenu meta={meta} doc={{ status: 'Open', member: '' }} />);
    expect(container).toBeEmptyDOMElement();
  });

  function drawRowButton(rowLink: EntityReportLink, doc: Record<string, unknown>) {
    return render(
      <MemoryRouter initialEntries={['/Membership']}>
        <Routes>
          <Route path="/:entity" element={<RowPrintButton link={rowLink} doc={doc} onPrint={() => {}} />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  const managersOnly = linkWith("doc.status == Open && 'Manager' in user.roles");

  it('are offered on a list row by the rule, read with the signed-in user', () => {
    session.user = MANAGER;
    drawRowButton(managersOnly, { status: 'Open' });
    expect(screen.getByRole('button', { name: 'Membership card' })).toBeInTheDocument();
  });

  it('are left out of a list row for a user the rule rules out', () => {
    session.user = CLERK;
    const { container } = drawRowButton(managersOnly, { status: 'Open' });
    expect(container).toBeEmptyDOMElement();
  });
});
