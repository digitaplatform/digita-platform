import { useEffect } from 'react';
import type { FieldDefinition } from '@digitaplatform/shared';

/**
 * Loud placeholder for a field type with no mapped control (or a layout type that
 * wrongly reached the registry). NEVER a silent fallback to a text box (F2) — a
 * missing control is a real gap the operator + the dev must both see.
 */
export function UnsupportedControl({
  fieldtype,
  reason,
  field,
}: {
  fieldtype: string;
  reason: string;
  field: FieldDefinition;
}) {
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.error(`[renderer] unsupported control for "${field.fieldname}": ${reason}`);
    }
  }, [field.fieldname, reason]);

  return (
    <div
      role="alert"
      className="rounded-md border border-error bg-error-light px-3 py-2 text-sm text-error"
    >
      Unsupported field type <strong>{fieldtype}</strong> ({field.fieldname})
    </div>
  );
}
