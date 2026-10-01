import { useMemo, useState } from 'react';
import type { ActionDefinition } from '@digitaplatform/shared';
import { BaseDialog, Button } from '@digitaplatform/components';
import { sweepFieldStates } from '@/lib/evaluate-field';
import { buildDefaults } from '@/lib/default-tokens';
import { useSessionStore } from '@/stores/session';
import { useChrome } from '@/lib/chrome-i18n';
import { FormRenderer } from '@/components/render/FormRenderer';
import { ActionOptionTexts } from '@/lib/option-text';
import type { UiMessage } from '@/lib/api-result';

type Doc = Record<string, unknown>;

/**
 * Modal for an action's `dialog_fields` — a mini meta form (reuses FormRenderer +
 * a flat field-state sweep). Collects the values and hands them to the action call;
 * the engine validates authoritatively (no client zod for dialog fields in P1).
 * Rides BaseDialog (one portal / focus trap / Escape ownership across the app).
 * A refusal of the action keeps the dialog and what the person typed: a message
 * that names a field of the dialog stands at that field, any other above the form.
 */
export function ActionDialog({
  entity,
  action,
  onCancel,
  onSubmit,
  refusal = [],
  busy = false,
}: {
  entity: string;
  action: ActionDefinition;
  onCancel: () => void;
  onSubmit: (values: Doc) => void;
  /** The messages of the action's last refusal. */
  refusal?: UiMessage[];
  /** The action runs; a second confirm would run it twice. */
  busy?: boolean;
}) {
  const user = useSessionStore((s) => s.user);
  const tc = useChrome();
  const fields = useMemo(() => action.dialog_fields ?? [], [action.dialog_fields]);

  const [values, setValues] = useState<Doc>(() => buildDefaults(fields, user));

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

  const { fieldErrors, formErrors } = useMemo(() => {
    const names = new Set(fields.map((f) => f.fieldname));
    const fieldErrors: Record<string, string> = {};
    const formErrors: string[] = [];
    for (const m of refusal) {
      if (m.path && names.has(m.path)) fieldErrors[m.path] = m.text;
      else formErrors.push(m.text);
    }
    return { fieldErrors, formErrors };
  }, [fields, refusal]);

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
          <Button type="button" disabled={busy} onClick={() => onSubmit(values)}>
            {tc('ui.action.confirm')}
          </Button>
        </div>
      }
    >
      {formErrors.length > 0 && (
        <div role="alert" className="mb-4 rounded-md bg-error-light p-3 text-sm text-error">
          {formErrors.map((text, i) => (
            <p key={i}>{text}</p>
          ))}
        </div>
      )}
      <ActionOptionTexts entity={entity} action={action.action}>
        <FormRenderer
          entity={entity}
          fields={fields}
          doc={values}
          fieldState={fieldState}
          errors={fieldErrors}
          onFieldChange={(fn, v) => setValues((p) => ({ ...p, [fn]: v }))}
        />
      </ActionOptionTexts>
    </BaseDialog>
  );
}
