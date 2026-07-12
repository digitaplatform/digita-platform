import { Send, Ban, FileEdit } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { EntityDefinition } from '@digitaplatform/shared';
import { Button } from '@digitaplatform/components';
import { evaluateExpr } from '@/lib/expression';
import { resolveWorkflowField } from '@/lib/workflow-field';
import { isAdministrator, hasEntityPermission } from '@/lib/permissions';
import { toUiMessages } from '@/lib/api-result';
import { useSessionStore } from '@/stores/session';
import { useI18nStore } from '@/stores/i18n';
import { useChrome } from '@/lib/chrome-i18n';
import { useDialogHost } from '@/components/overlay/DialogHost';
import { useSubmit, useCancel, useAmend, useTransition } from '@/hooks/useDocument';
import { tid } from '@/lib/testid';

type Doc = Record<string, unknown>;

/**
 * Generic workflow + docstatus action bar. Driven entirely by meta: Submit
 * (docstatus 0→1) / Cancel (1→2) / Amend (2→fresh draft) for submittable docs, plus
 * state transitions gated by from-state ∩ allowed_roles (Administrator bypass) + the
 * optional `condition` expression (evaluated client-side over {doc,user} for
 * VISIBILITY — the engine re-checks authoritatively). Acts on the SAVED doc; disabled
 * while the form is dirty (save first). Amend spawns a NEW draft (own `_id`,
 * `amended_from` → the source) and navigates to it. Renders nothing for plain entities.
 */
export function WorkflowBar({
  entity,
  meta,
  name,
  doc,
  disabled,
  onApplied,
}: {
  entity: string;
  meta: EntityDefinition;
  name: string;
  doc: Doc;
  disabled: boolean;
  onApplied: (doc: Doc) => void;
}) {
  const navigate = useNavigate();
  const user = useSessionStore((s) => s.user);
  const t = useI18nStore((s) => s.t);
  const tc = useChrome();
  const dialog = useDialogHost();
  const submitM = useSubmit<Doc>(entity);
  const cancelM = useCancel<Doc>(entity);
  const amendM = useAmend<Doc>(entity);
  const transM = useTransition<Doc>(entity);

  const docstatus = Number((doc['docstatus'] ?? 0) as number);
  const wf = resolveWorkflowField(meta);
  const current = wf ? doc[wf] : undefined;
  const admin = isAdministrator(user);
  const roles = new Set(user?.roles ?? []);
  const busy = submitM.isPending || cancelM.isPending || amendM.isPending || transM.isPending;

  const transitions = (meta.transitions ?? []).filter((tr) => {
    if (tr.from !== current && tr.from !== '*') return false;
    if (!admin && !tr.allowed_roles.some((r) => roles.has(r))) return false;
    if (tr.condition) {
      const r = evaluateExpr(tr.condition, { doc, user: (user as unknown as Doc) ?? {} });
      if (r.error) return true; // fail-open for visibility; the engine still enforces
      return r.value;
    }
    return true;
  });

  const canSubmit = !!meta.is_submittable && docstatus === 0;
  const canCancel = !!meta.is_submittable && docstatus === 1;
  // A cancelled (docstatus 2) submittable doc can be amended into a fresh draft —
  // gated by the `amend` permission (Administrator bypasses via hasEntityPermission).
  // The engine re-checks authoritatively; this is only for affordance visibility.
  const canAmend =
    !!meta.is_submittable && docstatus === 2 && hasEntityPermission(meta, user, 'amend');

  if (!canSubmit && !canCancel && !canAmend && transitions.length === 0) return null;

  const run = async (action: () => Promise<Doc>) => {
    try {
      const updated = await action();
      onApplied(updated);
      dialog.toast(tc('ui.record.saved'), 'success');
    } catch (e) {
      dialog.toast(toUiMessages(e, t)[0]?.text ?? tc('ui.status.somethingWrong'), 'error');
    }
  };

  const confirmThen = async (title: string, action: () => Promise<Doc>) => {
    const ok = await dialog.confirm({ title, confirmLabel: tc('ui.action.confirm') });
    if (ok) await run(action);
  };

  // Amend confirms, then spawns a NEW draft and NAVIGATES to it (a fresh doc with its
  // own _id linked back via amended_from) — unlike submit/cancel/transition, which
  // mutate THIS record in place (so we do not call onApplied here).
  const onAmend = async () => {
    const ok = await dialog.confirm({
      title: tc('ui.workflow.amendConfirm'),
      confirmLabel: tc('ui.action.confirm'),
    });
    if (!ok) return;
    try {
      const created = await amendM.mutateAsync(name);
      const id = created['_id'];
      dialog.toast(tc('ui.record.saved'), 'success');
      if (typeof id === 'string') navigate(`/${entity}/${encodeURIComponent(id)}`);
    } catch (e) {
      dialog.toast(toUiMessages(e, t)[0]?.text ?? tc('ui.status.somethingWrong'), 'error');
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {disabled && (
        <span className="text-xs text-textMuted">{tc('ui.workflow.saveFirst')}</span>
      )}
      {transitions.map((tr) => (
        <Button
          key={`${tr.from}->${tr.to}`}
          type="button"
          variant="secondary"
          disabled={disabled || busy}
          {...tid.transition(tr.to)}
          onClick={() => void run(() => transM.mutateAsync({ name, to: tr.to }))}
        >
          {tr.action || tr.to}
        </Button>
      ))}
      {canCancel && (
        <Button
          type="button"
          variant="danger"
          disabled={disabled || busy}
          {...tid.action('cancel')}
          onClick={() => void confirmThen(tc('ui.workflow.cancelConfirm'), () => cancelM.mutateAsync(name))}
        >
          <Ban className="h-4 w-4" aria-hidden="true" />
          {tc('ui.workflow.cancel')}
        </Button>
      )}
      {canSubmit && (
        <Button
          type="button"
          disabled={disabled || busy}
          loading={submitM.isPending}
          {...tid.action('submit')}
          onClick={() => void confirmThen(tc('ui.workflow.submitConfirm'), () => submitM.mutateAsync(name))}
        >
          {!submitM.isPending && <Send className="h-4 w-4" aria-hidden="true" />}
          {tc('ui.workflow.submit')}
        </Button>
      )}
      {canAmend && (
        <Button
          type="button"
          variant="primary"
          disabled={disabled || busy}
          loading={amendM.isPending}
          {...tid.action('amend')}
          onClick={() => void onAmend()}
        >
          {!amendM.isPending && <FileEdit className="h-4 w-4" aria-hidden="true" />}
          {tc('ui.workflow.amend')}
        </Button>
      )}
    </div>
  );
}
