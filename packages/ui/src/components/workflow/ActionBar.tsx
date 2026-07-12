import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ActionDefinition } from '@digitaplatform/shared';
import { Button } from '@digitaplatform/components';
import { toUiMessages } from '@/lib/api-result';
import { useI18nStore } from '@/stores/i18n';
import { useChrome } from '@/lib/chrome-i18n';
import { resolveIcon } from '@/lib/icon-registry';
import { tid } from '@/lib/testid';
import { useDialogHost } from '@/components/overlay/DialogHost';
import { useActions, useRunAction } from '@/hooks/useActions';
import { ActionDialog } from './ActionDialog';

type Doc = Record<string, unknown>;

const VARIANT = { primary: 'primary', danger: 'danger', default: 'secondary' } as const;

/**
 * Generic action buttons (entity.actions, already show_if + permission filtered by
 * the engine). A dialog action opens ActionDialog for its dialog_fields; the result
 * `{ created }` navigates to the spawned doc. Acts on the saved doc; disabled while
 * the form is dirty.
 */
export function ActionBar({
  entity,
  name,
  disabled,
}: {
  entity: string;
  name: string;
  disabled: boolean;
}) {
  const navigate = useNavigate();
  const t = useI18nStore((s) => s.t);
  const tc = useChrome();
  const dialog = useDialogHost();
  const { data: actions } = useActions(entity, name);
  const runM = useRunAction(entity);
  const [pending, setPending] = useState<ActionDefinition | null>(null);

  if (!actions || actions.length === 0) return null;

  const execute = async (action: ActionDefinition, body?: Doc) => {
    try {
      const res = await runM.mutateAsync({ name, action: action.action, body });
      dialog.toast(action.label, 'success');
      const result = res.result;
      const created = result?.created;
      if (created?.entity && created?.name) {
        navigate(`/${created.entity}/${encodeURIComponent(created.name)}`);
      }
      // File-producing actions: `download` (or the legacy {xml, filename}
      // shape, e.g. generateXRechnung) saves client-side; `open_url` opens.
      const download =
        result?.download ??
        (typeof result?.xml === 'string' && typeof result?.filename === 'string'
          ? { filename: result.filename, content: result.xml, mime_type: 'application/xml' }
          : undefined);
      if (download?.filename && (download.content_base64 || download.content)) {
        const bytes = download.content_base64
          ? Uint8Array.from(atob(download.content_base64), (c) => c.charCodeAt(0))
          : new TextEncoder().encode(download.content as string);
        const blob = new Blob([bytes], { type: download.mime_type ?? 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = download.filename;
        a.click();
        URL.revokeObjectURL(a.href);
      }
      if (typeof result?.open_url === 'string') {
        window.open(result.open_url, '_blank', 'noopener');
      }
    } catch (e) {
      dialog.toast(toUiMessages(e, t)[0]?.text ?? tc('ui.status.somethingWrong'), 'error');
    }
  };

  const onClick = async (action: ActionDefinition) => {
    if (action.opens_dialog && action.dialog_fields?.length) {
      setPending(action); // the dialog is itself the confirmation
      return;
    }
    if (action.confirm) {
      const ok = await dialog.confirm({
        title: tc('ui.action.confirmActionTitle', { action: action.label }),
        confirmLabel: action.label,
        danger: action.type === 'danger',
      });
      if (!ok) return;
    }
    void execute(action);
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => {
          const Icon = resolveIcon(a.icon);
          return (
            <Button
              key={a.action}
              type="button"
              variant={VARIANT[a.type ?? 'default']}
              disabled={disabled || runM.isPending}
              onClick={() => void onClick(a)}
              {...tid.action(a.action)}
            >
              {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
              {a.label}
            </Button>
          );
        })}
      </div>
      {pending && (
        <ActionDialog
          entity={entity}
          action={pending}
          onCancel={() => setPending(null)}
          onSubmit={(values) => {
            const action = pending;
            setPending(null);
            void execute(action, values);
          }}
        />
      )}
    </>
  );
}
