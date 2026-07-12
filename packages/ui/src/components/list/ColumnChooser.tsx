import { useState } from 'react';
import { ChevronUp, ChevronDown, RotateCcw, Check, X } from 'lucide-react';
import type { EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import { LAYOUT_FIELD_TYPES } from '@digitaplatform/shared';
import { Button, Checkbox, IconButton } from '@digitaplatform/components';
import { useI18nStore } from '@/stores/i18n';
import { useChrome } from '@/lib/chrome-i18n';

/**
 * Show / hide + reorder the list columns. PURE: the parent owns the `visible`
 * order array; we emit a new ordered array via onChange. `visible` order IS the
 * display order. Reorder uses up/down buttons (no drag lib). Toggling a column
 * on appends it to the end; toggling off removes it. "Reset" → in_list_view
 * default order (visible = []).
 *
 * Candidate columns = the entity's listable fields (in_list_view default set
 * PLUS any other non-layout/Table/ReadOnly field the user may opt in to).
 */

export interface ColumnChooserProps {
  meta: EntityDefinition;
  /** Ordered visible fieldnames. [] = use in_list_view defaults. */
  visible: string[];
  /** Commit the staged columns + close. */
  onSave: (cols: string[]) => void;
  /** Discard the staged changes + close. */
  onCancel: () => void;
}

function candidateFields(meta: EntityDefinition): FieldDefinition[] {
  return meta.fields.filter(
    (f) => !LAYOUT_FIELD_TYPES.includes(f.fieldtype) && f.fieldtype !== 'Table' && f.fieldtype !== 'ReadOnly',
  );
}

function defaultVisible(meta: EntityDefinition): string[] {
  return candidateFields(meta)
    .filter((f) => f.in_list_view === true)
    .map((f) => f.fieldname);
}

export function ColumnChooser({ meta, visible, onSave, onCancel }: ColumnChooserProps) {
  const tField = useI18nStore((s) => s.tField);
  const tc = useChrome();

  // Stage changes locally; commit on Save, discard on Cancel (in-card icon buttons).
  const [draft, setDraft] = useState<string[]>(visible);

  const candidates = candidateFields(meta);
  // Effective order: explicit draft, else the in_list_view defaults.
  const order = draft.length ? draft : defaultVisible(meta);
  const visibleSet = new Set(order);
  const dirty = JSON.stringify(draft) !== JSON.stringify(visible);

  // Shown first (in order), then the remaining candidates (hidden), label-sorted.
  const hidden = candidates
    .filter((f) => !visibleSet.has(f.fieldname))
    .sort((a, b) =>
      tField(meta.name, a.fieldname, a.label).localeCompare(tField(meta.name, b.fieldname, b.label)),
    );

  function toggle(fieldname: string, on: boolean): void {
    if (on) setDraft([...order, fieldname]);
    else setDraft(order.filter((c) => c !== fieldname));
  }

  function move(fieldname: string, dir: -1 | 1): void {
    const idx = order.indexOf(fieldname);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= order.length) return;
    const next = [...order];
    const tmp = next[idx]!;
    next[idx] = next[swap]!;
    next[swap] = tmp;
    setDraft(next);
  }

  function label(fieldname: string): string {
    const f = candidates.find((c) => c.fieldname === fieldname);
    return tField(meta.name, fieldname, f?.label ?? fieldname);
  }

  return (
    <div className="flex flex-col gap-3" role="group" aria-label={tc('ui.column.title')}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-textMain">{tc('ui.column.title')}</span>
        <Button
          type="button"
          variant="ghost"
          className="px-2 py-1 text-xs"
          onClick={() => setDraft([])}
          disabled={draft.length === 0}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          {tc('ui.column.reset')}
        </Button>
      </div>

      {/* Visible (ordered) */}
      <ul className="flex flex-col gap-1">
        {order.map((fieldname, i) => (
          <li
            key={fieldname}
            className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
          >
            <Checkbox
              checked
              aria-label={tc('ui.column.toggle', { field: label(fieldname) })}
              onChange={() => toggle(fieldname, false)}
            />
            <span className="flex-1 truncate text-textMain">{label(fieldname)}</span>
            <IconButton
              size="sm"
              label={tc('ui.column.moveUp', { field: label(fieldname) })}
              disabled={i === 0}
              onClick={() => move(fieldname, -1)}
              icon={<ChevronUp className="h-4 w-4" aria-hidden="true" />}
            />
            <IconButton
              size="sm"
              label={tc('ui.column.moveDown', { field: label(fieldname) })}
              disabled={i === order.length - 1}
              onClick={() => move(fieldname, 1)}
              icon={<ChevronDown className="h-4 w-4" aria-hidden="true" />}
            />
          </li>
        ))}
      </ul>

      {/* Hidden (addable) */}
      {hidden.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-textMuted">
            {tc('ui.column.available')}
          </span>
          <ul className="flex flex-col gap-1">
            {hidden.map((f) => (
              <li key={f.fieldname} className="flex items-center gap-2 px-2 py-1 text-sm">
                <Checkbox
                  checked={false}
                  aria-label={tc('ui.column.toggle', { field: label(f.fieldname) })}
                  onChange={() => toggle(f.fieldname, true)}
                />
                <span className="flex-1 truncate text-textMuted">{label(f.fieldname)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* In-card Save / Cancel — icon-only, internationally legible (✓ / ✕). */}
      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <IconButton
          label={tc('ui.action.cancel')}
          variant="ghost"
          onClick={onCancel}
          icon={<X className="h-4 w-4" aria-hidden="true" />}
        />
        <IconButton
          label={tc('ui.action.save')}
          variant="primary"
          onClick={() => onSave(draft)}
          disabled={!dirty}
          icon={<Check className="h-4 w-4" aria-hidden="true" />}
        />
      </div>
    </div>
  );
}
