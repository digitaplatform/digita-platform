import { useMemo, useState } from 'react';
import type { ActionDefinition } from '@digitaplatform/shared';
import { BaseDialog, Button } from '@digitaplatform/components';
import { sweepFieldStates } from '@/lib/evaluate-field';
import { useSessionStore } from '@/stores/session';
import { useChrome } from '@/lib/chrome-i18n';
import { FormRenderer } from '@/components/render/FormRenderer';

type Doc = Record<string, unknown>;

/**
 * Modal for an action's `dialog_fields` — a mini meta form (reuses FormRenderer +
 * a flat field-state sweep). Collects the values and hands them to the action call;
 * the engine validates authoritatively (no client zod for dialog fields in P1).
 * Rides BaseDialog (one portal / focus trap / Escape ownership across the app).
 */
export function ActionDialog({
  entity,
  action,
  onCancel,
  onSubmit,
}: {
  entity: string;
  action: ActionDefinition;
  onCancel: () => void;
  onSubmit: (values: Doc) => void;
}) {
  const user = useSessionStore((s) => s.user);
  const tc = useChrome();
  const fields = useMemo(() => action.dialog_fields ?? [], [action.dialog_fields]);

  const [values, setValues] = useState<Doc>(() => {
    const seed: Doc = {};
    for (const f of fields) if (f.default !== undefined) seed[f.fieldname] = f.default;
    return seed;
  });

  const fieldState = useMemo(
    () =>
      sweepFieldStates(fields, {
        scope: { doc: values, user: (user as unknown as Doc) ?? {} },
        computedSet: new Set<string>(),
        frozenSet: new Set<string>(),
        docstatus: 0,
        isSubmittable: false,
        allowOnSubmitSet: new Set<string>(),
        isNew: true,
        canWriteLevel: () => true,
      }),
    [fields, values, user],
  );

  return (
    <BaseDialog
      open
      onClose={onCancel}
      title={action.label}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            {tc('ui.action.cancel')}
          </Button>
          <Button type="button" onClick={() => onSubmit(values)}>
            {tc('ui.action.confirm')}
          </Button>
        </div>
      }
    >
      <FormRenderer
        entity={entity}
        fields={fields}
        doc={values}
        fieldState={fieldState}
        errors={{}}
        onFieldChange={(fn, v) => setValues((p) => ({ ...p, [fn]: v }))}
      />
    </BaseDialog>
  );
}
