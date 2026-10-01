// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { EntityDefinition } from '@digitaplatform/shared';

// The session user drives role-gating; reset per test.
let user: { _id?: string; email?: string; roles: string[] } | null = { roles: ['Editor'] };

vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: { user: typeof user }) => unknown) => sel({ user }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: { t: (k: string) => string }) => unknown) => sel({ t: (k: string) => k }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ toast: vi.fn(), confirm: vi.fn().mockResolvedValue(true) }),
}));
vi.mock('@/hooks/useDocument', () => {
  const m = () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false });
  return { useSubmit: m, useCancel: m, useAmend: m, useTransition: m };
});
// WorkflowBar navigates to the new draft after an amend.
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

// `evaluateExpr` + `isAdministrator` are real (pure) — the gating logic is what we test.
import { WorkflowBar } from '@/components/workflow/WorkflowBar';

afterEach(cleanup);
beforeEach(() => {
  user = { roles: ['Editor'] };
});

type Doc = Record<string, unknown>;

function meta(extra: Partial<EntityDefinition> = {}): EntityDefinition {
  return { name: 'Widget', fields: [], permissions: [], ...extra } as unknown as EntityDefinition;
}

function renderBar(m: EntityDefinition, doc: Doc) {
  return render(
    <WorkflowBar entity="Widget" meta={m} name="W-1" doc={doc} disabled={false} onApplied={() => {}} />,
  );
}

describe('WorkflowBar (generic, meta-driven)', () => {
  it('renders nothing for a plain (non-submittable, no-transition) entity', () => {
    const { container } = renderBar(meta({ is_submittable: false }), { docstatus: 0, status: 'draft' });
    expect(container.firstChild).toBeNull();
  });

  it('submittable draft (docstatus 0): shows Submit, not Cancel', () => {
    const m = meta({ is_submittable: true, permissions: [{ role: 'Editor', level: 0, submit: 1, cancel: 1 }] });
    const { queryByText } = renderBar(m, { docstatus: 0 });
    expect(queryByText('ui.workflow.submit')).not.toBeNull();
    expect(queryByText('ui.workflow.cancel')).toBeNull();
  });

  it('submitted doc (docstatus 1): shows Cancel, not Submit', () => {
    const m = meta({ is_submittable: true, permissions: [{ role: 'Editor', level: 0, submit: 1, cancel: 1 }] });
    const { queryByText } = renderBar(m, { docstatus: 1 });
    expect(queryByText('ui.workflow.cancel')).not.toBeNull();
    expect(queryByText('ui.workflow.submit')).toBeNull();
  });

  it('submittable draft for a role that may write but not submit: no Submit', () => {
    const m = meta({
      is_submittable: true,
      permissions: [{ role: 'Editor', level: 0, read: 1, write: 1, create: 1 }],
    });
    const { container } = renderBar(m, { docstatus: 0 });
    expect(container.firstChild).toBeNull();
  });

  it('submitted doc for a role without cancel: no Cancel', () => {
    const m = meta({
      is_submittable: true,
      permissions: [{ role: 'Editor', level: 0, read: 1, write: 1, create: 1, submit: 1 }],
    });
    const { container } = renderBar(m, { docstatus: 1 });
    expect(container.firstChild).toBeNull();
  });

  it('a submit or cancel bit on a level-1 row offers neither Submit nor Cancel', () => {
    const m = meta({
      is_submittable: true,
      permissions: [
        { role: 'Editor', level: 0, read: 1, write: 1 },
        { role: 'Editor', level: 1, read: 1, submit: 1, cancel: 1 },
      ],
    });
    expect(renderBar(m, { docstatus: 0 }).container.firstChild).toBeNull();
    cleanup();
    expect(renderBar(m, { docstatus: 1 }).container.firstChild).toBeNull();
  });

  it("offers no Submit on another user's draft where submit needs ownership, and Submit to its owner", () => {
    user = { _id: 'u-ann', email: 'ann@example.com', roles: ['Editor'] };
    const m = meta({
      is_submittable: true,
      permissions: [{ role: 'Editor', level: 0, read: 1, write: 1, submit: 1, if_owner: true }],
    });
    expect(renderBar(m, { docstatus: 0, owner: 'bob@example.com' }).container.firstChild).toBeNull();
    cleanup();
    expect(renderBar(m, { docstatus: 0, owner: 'ann@example.com' }).queryByText('ui.workflow.submit')).not.toBeNull();
  });

  it('offers no Cancel where the cancel row condition does not hold for the document', () => {
    const m = meta({
      is_submittable: true,
      permissions: [{ role: 'Editor', level: 0, read: 1, cancel: 1, condition: 'eval:doc.paid != 1' }],
    });
    expect(renderBar(m, { docstatus: 1, paid: 1 }).container.firstChild).toBeNull();
    cleanup();
    expect(renderBar(m, { docstatus: 1, paid: 0 }).queryByText('ui.workflow.cancel')).not.toBeNull();
  });

  it('offers no Submit in a workflow state that strips submit from the role', () => {
    const m = meta({
      is_submittable: true,
      permissions: [{ role: 'Editor', level: 0, read: 1, submit: 1 }],
      states: [{ value: 'on_hold', color: 'amber', permissions: [{ role: 'Editor', submit: 0 }] }],
    });
    expect(renderBar(m, { docstatus: 0, status: 'on_hold' }).container.firstChild).toBeNull();
  });

  it("offers no Amend on another user's cancelled document where amend needs ownership", () => {
    user = { _id: 'u-ann', email: 'ann@example.com', roles: ['Editor'] };
    const m = meta({
      is_submittable: true,
      permissions: [{ role: 'Editor', level: 0, amend: 1, create: 1, if_owner: true }],
    });
    expect(renderBar(m, { docstatus: 2, owner: 'bob@example.com' }).container.firstChild).toBeNull();
    cleanup();
    expect(renderBar(m, { docstatus: 2, owner: 'ann@example.com' }).queryByText('ui.workflow.amend')).not.toBeNull();
  });

  it('Administrator is offered Submit and Cancel without a permission row', () => {
    user = { roles: ['Administrator'] };
    const m = meta({ is_submittable: true });
    expect(renderBar(m, { docstatus: 0 }).queryByText('ui.workflow.submit')).not.toBeNull();
    cleanup();
    expect(renderBar(m, { docstatus: 1 }).queryByText('ui.workflow.cancel')).not.toBeNull();
  });

  it('cancelled doc (docstatus 2) with amend and create permission: shows Amend', () => {
    const m = meta({ is_submittable: true, permissions: [{ role: 'Editor', level: 0, amend: 1, create: 1 }] });
    user = { roles: ['Editor'] };
    const { queryByText } = renderBar(m, { docstatus: 2 });
    expect(queryByText('ui.workflow.amend')).not.toBeNull();
  });

  // An amend inserts a new draft, so the engine refuses it without create.
  it('cancelled doc with amend but without create permission: renders nothing (Amend hidden)', () => {
    const m = meta({ is_submittable: true, permissions: [{ role: 'Editor', level: 0, amend: 1 }] });
    user = { roles: ['Editor'] };
    const { container } = renderBar(m, { docstatus: 2 });
    expect(container.firstChild).toBeNull();
  });

  it('cancelled doc of an entity whose permission rows the engine withheld: shows Amend', () => {
    user = { roles: ['Editor'] };
    expect(renderBar(meta({ is_submittable: true }), { docstatus: 2 }).queryByText('ui.workflow.amend')).not.toBeNull();
  });

  it('cancelled doc without amend permission: renders nothing (Amend hidden)', () => {
    const m = meta({ is_submittable: true, permissions: [{ role: 'Editor', level: 0, cancel: 1 }] });
    user = { roles: ['Editor'] };
    const { container } = renderBar(m, { docstatus: 2 });
    expect(container.firstChild).toBeNull();
  });

  it('Administrator bypasses the amend permission on a cancelled doc', () => {
    const m = meta({ is_submittable: true }); // no explicit amend perm
    user = { roles: ['Administrator'] };
    const { queryByText } = renderBar(m, { docstatus: 2 });
    expect(queryByText('ui.workflow.amend')).not.toBeNull();
  });

  it('transition is hidden when the user lacks an allowed role', () => {
    const m = meta({
      transitions: [{ from: 'draft', to: 'sent', action: 'Send', allowed_roles: ['Approver'] }],
    });
    user = { roles: ['Editor'] };
    const { container } = renderBar(m, { status: 'draft', docstatus: 0 });
    expect(container.firstChild).toBeNull(); // no submit/cancel/transition → renders nothing
  });

  it('transition is shown when the user holds an allowed role', () => {
    const m = meta({
      transitions: [{ from: 'draft', to: 'sent', action: 'Send', allowed_roles: ['Approver'] }],
    });
    user = { roles: ['Approver'] };
    const { queryByText } = renderBar(m, { status: 'draft', docstatus: 0 });
    expect(queryByText('Send')).not.toBeNull();
  });

  it('a transition with empty allowed_roles is offered to every user, as the engine allows it', () => {
    const m = meta({
      transitions: [{ from: 'draft', to: 'confirmed', action: 'Confirm', allowed_roles: [] }],
    });
    user = { roles: ['Librarian'] };
    const { queryByText } = renderBar(m, { status: 'draft', docstatus: 0 });
    expect(queryByText('Confirm')).not.toBeNull();
  });

  it('Administrator bypasses allowed_roles', () => {
    const m = meta({
      transitions: [{ from: 'draft', to: 'sent', action: 'Send', allowed_roles: ['Approver'] }],
    });
    user = { roles: ['Administrator'] };
    const { queryByText } = renderBar(m, { status: 'draft', docstatus: 0 });
    expect(queryByText('Send')).not.toBeNull();
  });

  it('from-state gate: only transitions whose `from` matches the current state are offered', () => {
    const m = meta({
      transitions: [
        { from: 'sent', to: 'accepted', action: 'Accept', allowed_roles: ['Approver'] },
      ],
    });
    user = { roles: ['Approver'] };
    // current state is draft, transition is from `sent` → hidden
    const { container } = renderBar(m, { status: 'draft', docstatus: 0 });
    expect(container.firstChild).toBeNull();
  });

  it('condition gate: a transition with a falsy `condition` is hidden, truthy is shown', () => {
    const m = meta({
      transitions: [
        {
          from: 'draft',
          to: 'sent',
          action: 'Send',
          allowed_roles: ['Editor'],
          condition: 'eval:doc.ready==true',
        },
      ],
    });
    user = { roles: ['Editor'] };
    expect(renderBar(m, { status: 'draft', docstatus: 0, ready: false }).queryByText('Send')).toBeNull();
    cleanup();
    expect(renderBar(m, { status: 'draft', docstatus: 0, ready: true }).queryByText('Send')).not.toBeNull();
  });
});
