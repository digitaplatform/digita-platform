// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { EntityDefinition } from '@digitaplatform/shared';

// The session user drives role-gating; reset per test.
let user: { roles: string[] } | null = { roles: ['Editor'] };

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
    const { queryByText } = renderBar(meta({ is_submittable: true }), { docstatus: 0 });
    expect(queryByText('ui.workflow.submit')).not.toBeNull();
    expect(queryByText('ui.workflow.cancel')).toBeNull();
  });

  it('submitted doc (docstatus 1): shows Cancel, not Submit', () => {
    const { queryByText } = renderBar(meta({ is_submittable: true }), { docstatus: 1 });
    expect(queryByText('ui.workflow.cancel')).not.toBeNull();
    expect(queryByText('ui.workflow.submit')).toBeNull();
  });

  it('cancelled doc (docstatus 2) with amend permission: shows Amend', () => {
    const m = meta({ is_submittable: true, permissions: [{ role: 'Editor', level: 0, amend: 1 }] });
    user = { roles: ['Editor'] };
    const { queryByText } = renderBar(m, { docstatus: 2 });
    expect(queryByText('ui.workflow.amend')).not.toBeNull();
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
