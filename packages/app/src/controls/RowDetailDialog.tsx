import { useEffect, useId, useState } from 'react';
import { BaseDialog, Button } from '@digitaplatform/components';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlState } from '@/controls/types';
import type { FieldStateMap } from '@/lib/evaluate-field';
import { ControlRenderer } from '@/components/render/ControlRenderer';
import { useChrome } from '@/lib/chrome-i18n';
import { useI18nStore } from '@/stores/i18n';

type Row = Record<string, unknown>;

const DEFAULT_STATE: FieldControlState = {
  visible: true,
  required: false,
  readOnly: false,
  invalid: false,
  isComputed: false,
  isFrozen: false,
  updating: false,
};

interface RowDetailDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Editable fields shown in the dialog, in order. */
  fields: FieldDefinition[];
  /** Per-field state for the edited row (visibility / required / read-only). */
  stateMap: FieldStateMap;
  /** The row being edited. */
  row: Row;
  entity: string;
  parentDoc: Row;
  /** Persist the edited row; the caller merges it back and triggers the recompute. */
  onSave: (updated: Row) => void;
}

/**
 * Edit one grid row's fields in a modal (a {@link BaseDialog}) rather than inline —
 * the line-entry-style detail editor. Each field renders through the shared control
 * registry with its per-row state; Save hands the merged row back to the caller,
 * which applies it and lets the preview pipeline recompute totals. Generic: it
 * edits whatever fields it is given.
 */
export function RowDetailDialog({
  open,
  onClose,
  title,
  fields,
  stateMap,
  row,
  entity,
  parentDoc,
  onSave,
}: RowDetailDialogProps) {
  const tc = useChrome();
  const tField = useI18nStore((s) => s.tField);
  const baseId = useId();
  const [draft, setDraft] = useState<Row>(row);

  // Re-seed the draft whenever the dialog (re)opens on a row.
  useEffect(() => {
    if (open) setDraft(row);
  }, [open, row]);

  const set = (name: string, value: unknown) => setDraft((d) => ({ ...d, [name]: value }));
  const visibleFields = fields.filter((f) => stateMap[f.fieldname]?.visible !== false);

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title={title}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {tc('ui.action.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            {tc('ui.action.save')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {visibleFields.map((f) => {
          const st = stateMap[f.fieldname] ?? DEFAULT_STATE;
          const id = `${baseId}-${f.fieldname}`;
          const labelId = `${id}-label`;
          return (
            <div key={f.fieldname}>
              <label
                id={labelId}
                htmlFor={id}
                className="mb-1 block text-sm font-medium text-textMain"
              >
                {tField(entity, f.fieldname, f.label)}
                {st.required && (
                  <span className="ml-0.5 text-error" aria-hidden="true">
                    *
                  </span>
                )}
              </label>
              <ControlRenderer
                field={f}
                value={draft[f.fieldname]}
                doc={draft}
                row={draft}
                parentDoc={parentDoc}
                entity={entity}
                state={st}
                onChange={(v) => set(f.fieldname, v)}
                controlId={id}
                labelId={labelId}
              />
            </div>
          );
        })}
      </div>
    </BaseDialog>
  );
}
