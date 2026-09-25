import { Check, X, Trash2 } from 'lucide-react';
import { Button } from '@digitaplatform/components';
import { useChrome } from '@/lib/chrome-i18n';
import { useDialogHost } from '@/components/overlay/DialogHost';
import { tid } from '@/lib/testid';

/**
 * The ONE universal Save / Cancel / Delete action bar — identical on every record
 * form so the concept is learned once. Same icons everywhere (Check / X / Trash2)
 * with visible labels (icon-only is reserved for dense/secondary controls; the
 * primary bar keeps labels so they read on touch where tooltips never show). Delete
 * is set apart on the left so it is never adjacent to Save. Delete always confirms;
 * Save confirms in the form submit (after validation); the page's nav-blocker owns
 * the dirty-discard prompt on Cancel (so it is asked exactly once). Sticky bottom
 * bar on phone, inline on desktop.
 */
export interface RecordActionsProps {
  saving: boolean;
  isNew: boolean;
  /** Show Delete (existing records only). */
  canDelete?: boolean;
  /** Block Save (e.g. an unresolved edit conflict). */
  saveDisabled?: boolean;
  /** Hide Save entirely (a submitted/cancelled doc the engine will never accept a
   *  PUT for — don't offer an affordance the engine rejects). */
  hideSave?: boolean;
  /** Any record mutation in flight → disables the whole bar. */
  busy?: boolean;
  onCancel: () => void;
  onDelete?: () => void;
}

export function RecordActions({
  saving,
  isNew,
  canDelete,
  saveDisabled,
  hideSave,
  busy,
  onCancel,
  onDelete,
}: RecordActionsProps) {
  const tc = useChrome();
  const dialog = useDialogHost();

  const handleDelete = async () => {
    if (!onDelete) return;
    const ok = await dialog.confirm({
      title: tc('ui.action.confirmDeleteTitle'),
      message: tc('ui.action.confirmDeleteBody'),
      confirmLabel: tc('ui.action.delete'),
      danger: true,
    });
    if (ok) onDelete();
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface/95 p-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
      <div className="flex items-center gap-2">
        {!isNew && canDelete && onDelete && (
          <Button type="button" variant="danger" onClick={handleDelete} disabled={busy} {...tid.action('delete')}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {tc('ui.action.delete')}
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy} {...tid.action('cancel')}>
            <X className="h-4 w-4" aria-hidden="true" />
            {tc('ui.action.cancel')}
          </Button>
          {!hideSave && (
            <Button type="submit" loading={saving} disabled={saveDisabled || busy} {...tid.action('save')}>
              {!saving && <Check className="h-4 w-4" aria-hidden="true" />}
              {isNew ? tc('ui.action.create') : tc('ui.action.save')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
